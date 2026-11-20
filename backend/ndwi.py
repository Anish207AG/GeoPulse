
import base64
from io import BytesIO

import numpy as np
import rasterio

from PIL import Image
from pystac_client import Client

from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.transform import array_bounds
from rasterio.vrt import WarpedVRT
from rasterio.warp import (
    calculate_default_transform,
    reproject,
    transform_bounds,
)
from rasterio.windows import Window, from_bounds


# ==========================================
# GeoPulse NDWI Configuration
# ==========================================

CATALOG_URL = "https://earth-search.aws.element84.com/v1"
COLLECTION = "sentinel-2-l2a"

MAX_PIXELS = 4_000_000
MAX_SCENES = 10

WATER_THRESHOLD = 0.0

# Sentinel-2 SCL invalid classes:
# 0: No data
# 1: Saturated/defective
# 3: Cloud shadows
# 8: Medium probability clouds
# 9: High probability clouds
# 10: Cirrus
# 11: Snow/ice

INVALID_SCL_CLASSES = [0, 1, 3, 8, 9, 10, 11]


# ==========================================
# Read Satellite Raster Band
# ==========================================

def read_band(
    url,
    bbox,
    target_crs=None,
    target_transform=None,
    target_shape=None,
    resampling=Resampling.bilinear,
):
    with rasterio.open(url) as src:

        if target_crs is None:
            bounds = transform_bounds(
                "EPSG:4326",
                src.crs,
                *bbox,
                densify_pts=21,
            )

            requested_window = from_bounds(
                *bounds,
                transform=src.transform,
            )

            col_start = int(
                np.floor(requested_window.col_off)
            )
            row_start = int(
                np.floor(requested_window.row_off)
            )
            col_end = int(
                np.ceil(
                    requested_window.col_off
                    + requested_window.width
                )
            )
            row_end = int(
                np.ceil(
                    requested_window.row_off
                    + requested_window.height
                )
            )

            width = col_end - col_start
            height = row_end - row_start

            if width <= 0 or height <= 0:
                raise ValueError(
                    "Invalid raster dimensions."
                )

            if width * height > MAX_PIXELS:
                raise ValueError(
                    "Selected area is too large. "
                    "Select a smaller rectangle."
                )

            window = Window(
                col_start,
                row_start,
                width,
                height,
            )

            data = src.read(
                1,
                window=window,
                boundless=True,
                masked=True,
                fill_value=(
                    src.nodata
                    if src.nodata is not None
                    else 0
                ),
            )

            return {
                "data": data,
                "crs": src.crs,
                "transform": src.window_transform(window),
                "shape": data.shape,
            }

        if (
            target_transform is None
            or target_shape is None
        ):
            raise ValueError(
                "Target raster alignment is missing."
            )

        height, width = target_shape

        with WarpedVRT(
            src,
            crs=target_crs,
            transform=target_transform,
            width=width,
            height=height,
            resampling=resampling,
        ) as vrt:

            data = vrt.read(
                1,
                masked=True,
            )

            return {
                "data": data,
                "crs": target_crs,
                "transform": target_transform,
                "shape": data.shape,
            }


# ==========================================
# Process One Sentinel-2 Scene
# ==========================================

def process_scene(scene, bbox):

    required_assets = (
        "green",
        "nir",
        "scl",
    )

    for asset_name in required_assets:
        if asset_name not in scene.assets:
            raise ValueError(
                f"Missing {asset_name} asset."
            )

    # Green band B03: reference grid

    green_band = read_band(
        scene.assets["green"].href,
        bbox,
    )

    green = green_band["data"].astype(
        np.float32
    )

    target_crs = green_band["crs"]
    target_transform = green_band["transform"]
    target_shape = green_band["shape"]

    # NIR band B08: aligned to Green

    nir_band = read_band(
        scene.assets["nir"].href,
        bbox,
        target_crs=target_crs,
        target_transform=target_transform,
        target_shape=target_shape,
        resampling=Resampling.bilinear,
    )

    nir = nir_band["data"].astype(
        np.float32
    )

    # SCL: nearest-neighbor alignment

    scl_band = read_band(
        scene.assets["scl"].href,
        bbox,
        target_crs=target_crs,
        target_transform=target_transform,
        target_shape=target_shape,
        resampling=Resampling.nearest,
    )

    scl = scl_band["data"]

    # ======================================
    # Detect Missing Pixels
    # ======================================

    green_missing = np.ma.getmaskarray(green)
    nir_missing = np.ma.getmaskarray(nir)
    scl_missing = np.ma.getmaskarray(scl)

    missing_band = (
        green_missing
        | nir_missing
        | scl_missing
    )

    # ======================================
    # Apply Cloud Mask
    # ======================================

    scl_values = np.ma.filled(
        scl, 0
    ).astype(np.uint8)

    invalid_scl = np.isin(
        scl_values,
        INVALID_SCL_CLASSES,
    )

    # ======================================
    # Calculate NDWI
    # Formula: (Green - NIR) / (Green + NIR)
    # ======================================

    green_values = np.ma.filled(
        green, 0
    ).astype(np.float32)

    nir_values = np.ma.filled(
        nir, 0
    ).astype(np.float32)

    denominator = green_values + nir_values

    invalid_denominator = (
        ~np.isfinite(denominator)
        | (denominator <= 0)
    )

    with np.errstate(
        divide="ignore",
        invalid="ignore",
    ):
        ndwi_values = (
            green_values - nir_values
        ) / np.where(
            denominator == 0,
            1,
            denominator,
        )

    invalid_ndwi = (
        ~np.isfinite(ndwi_values)
        | (ndwi_values < -1)
        | (ndwi_values > 1)
    )

    invalid = (
        missing_band
        | invalid_scl
        | invalid_denominator
        | invalid_ndwi
    )

    ndwi = np.ma.array(
        ndwi_values,
        mask=invalid,
    )

    # ======================================
    # Coverage Statistics
    # ======================================

    total_pixels = int(ndwi.size)

    valid_pixels = int(
        np.count_nonzero(~invalid)
    )

    valid_percentage = (
        100 * valid_pixels / total_pixels
        if total_pixels
        else 0
    )

    diagnostics = {
        "green_band_missing_pixels": int(
            np.count_nonzero(green_missing)
        ),
        "nir_band_missing_pixels": int(
            np.count_nonzero(nir_missing)
        ),
        "scl_band_missing_pixels": int(
            np.count_nonzero(scl_missing)
        ),
        "any_band_missing_pixels": int(
            np.count_nonzero(missing_band)
        ),
        "invalid_scl_pixels": int(
            np.count_nonzero(
                invalid_scl & ~missing_band
            )
        ),
        "invalid_denominator_pixels": int(
            np.count_nonzero(
                invalid_denominator & ~missing_band
            )
        ),
        "invalid_ndwi_pixels": int(
            np.count_nonzero(
                invalid_ndwi & ~missing_band
            )
        ),
        "total_invalid_pixels": int(
            np.count_nonzero(invalid)
        ),
        "scl_class_counts": {},
    }

    for class_id in range(12):
        count = int(
            np.count_nonzero(
                (scl_values == class_id)
                & ~scl_missing
            )
        )

        diagnostics["scl_class_counts"][
            str(class_id)
        ] = count

    return {
        "scene": scene,
        "ndwi": ndwi,
        "crs": target_crs,
        "transform": target_transform,
        "total_pixels": total_pixels,
        "valid_pixels": valid_pixels,
        "valid_percentage": valid_percentage,
        "diagnostics": diagnostics,
    }


# ==========================================
# Step 20: Transparent NDWI Overlay
# ==========================================

def build_ndwi_overlay(
    ndwi,
    raster_crs,
    raster_transform,
):

    values = np.ma.filled(
        ndwi,
        np.nan,
    ).astype(np.float32)

    height, width = values.shape

    # Transparent RGBA canvas.
    # All pixels initially have alpha = 0.

    rgba = np.zeros(
        (height, width, 4),
        dtype=np.uint8,
    )

    valid = np.isfinite(values)

    # ======================================
    # Water Classification
    # ======================================

    # NDWI <= 0:
    # Non-water remains transparent.

    low_water = (
        valid
        & (values > 0)
        & (values <= 0.2)
    )

    moderate_water = (
        valid
        & (values > 0.2)
        & (values <= 0.4)
    )

    high_water = (
        valid
        & (values > 0.4)
    )

    # Light blue: weak positive NDWI
    rgba[low_water] = [
        125, 211, 252, 180
    ]

    # Medium blue: moderate positive NDWI
    rgba[moderate_water] = [
        14, 165, 233, 210
    ]

    # Dark blue: strong positive NDWI
    rgba[high_water] = [
        29, 78, 216, 230
    ]

    # Non-water and invalid pixels:
    # [0, 0, 0, 0] = fully transparent.

    # ======================================
    # Geographic Reprojection
    # ======================================

    left, bottom, right, top = array_bounds(
        height,
        width,
        raster_transform,
    )

    destination_crs = CRS.from_epsg(4326)

    (
        destination_transform,
        destination_width,
        destination_height,
    ) = calculate_default_transform(
        raster_crs,
        destination_crs,
        width,
        height,
        left,
        bottom,
        right,
        top,
    )

    if (
        destination_width * destination_height
        > MAX_PIXELS * 2
    ):
        raise ValueError(
            "NDWI overlay is too large."
        )

    projected = np.zeros(
        (
            destination_height,
            destination_width,
            4,
        ),
        dtype=np.uint8,
    )

    # Reproject all four RGBA channels.

    for channel in range(4):
        reproject(
            source=rgba[:, :, channel],
            destination=projected[:, :, channel],
            src_transform=raster_transform,
            src_crs=raster_crs,
            dst_transform=destination_transform,
            dst_crs=destination_crs,
            src_nodata=None,
            dst_nodata=None,
            resampling=Resampling.nearest,
        )

    # ======================================
    # Encode PNG for Leaflet
    # ======================================

    image = Image.fromarray(
        projected,
        mode="RGBA",
    )

    buffer = BytesIO()

    image.save(
        buffer,
        format="PNG",
    )

    encoded = base64.b64encode(
        buffer.getvalue()
    ).decode("utf-8")

    west, south, east, north = array_bounds(
        destination_height,
        destination_width,
        destination_transform,
    )

    return {
        "image": (
            "data:image/png;base64,"
            + encoded
        ),
        "bounds": [
            [south, west],
            [north, east],
        ],
        "width": destination_width,
        "height": destination_height,
        "opacity": 0.75,
        "legend": [
            {
                "label": "NDWI <= 0 (Transparent)",
                "color": "transparent",
            },
            {
                "label": "0 to 0.2",
                "color": "#7dd3fc",
            },
            {
                "label": "0.2 to 0.4",
                "color": "#0ea5e9",
            },
            {
                "label": "Above 0.4",
                "color": "#1d4ed8",
            },
        ],
    }


# ==========================================
# Calculate NDWI from Best Satellite Scene
# ==========================================

def calculate_ndwi(
    bbox,
    start_date,
    end_date,
    max_cloud_cover=30,
):

    catalog = Client.open(
        CATALOG_URL
    )

    search = catalog.search(
        collections=[COLLECTION],
        bbox=bbox,
        datetime=f"{start_date}/{end_date}",
        query={
            "eo:cloud_cover": {
                "lte": max_cloud_cover
            }
        },
        max_items=MAX_SCENES,
    )

    scenes = list(search.items())

    if not scenes:
        raise ValueError(
            "No Sentinel-2 scenes found. "
            "Try another date range."
        )

    # Examine lower-cloud scenes first.

    scenes.sort(
        key=lambda scene: (
            scene.properties.get(
                "eo:cloud_cover"
            )
            if scene.properties.get(
                "eo:cloud_cover"
            ) is not None
            else 100
        )
    )

    candidates = []

    best_result = None
    best_score = (-1, -1)

    # ======================================
    # Evaluate Candidate Scenes
    # ======================================

    for scene in scenes:

        try:
            result = process_scene(
                scene,
                bbox,
            )

            coverage = result[
                "valid_percentage"
            ]

            candidates.append({
                "scene_id": scene.id,
                "scene_cloud_cover": (
                    scene.properties.get(
                        "eo:cloud_cover"
                    )
                ),
                "valid_pixel_percentage": round(
                    coverage, 2
                ),
                "valid_pixels": result[
                    "valid_pixels"
                ],
                "total_pixels": result[
                    "total_pixels"
                ],
                "status": "evaluated",
            })

            score = (
                coverage,
                result["valid_pixels"],
            )

            if score > best_score:
                best_score = score
                best_result = result

        except Exception as error:

            print(
                f"NDWI scene {scene.id} failed:",
                error,
            )

            candidates.append({
                "scene_id": scene.id,
                "status": "failed",
                "reason": str(error),
            })

    if best_result is None:
        raise ValueError(
            "Unable to process any candidate scene. "
            "Check satellite coverage and backend logs."
        )

    if best_result["valid_pixels"] == 0:
        raise ValueError(
            "No valid NDWI pixels found. "
            "Try another date range."
        )

    # ======================================
    # Selected Scene
    # ======================================

    scene = best_result["scene"]
    ndwi = best_result["ndwi"]

    valid_values = ndwi.compressed()

    valid_pixels = best_result[
        "valid_pixels"
    ]

    total_pixels = best_result[
        "total_pixels"
    ]

    # ======================================
    # Water Statistics
    # ======================================

    water_pixels = int(
        np.count_nonzero(
            valid_values > WATER_THRESHOLD
        )
    )

    water_percentage = (
        100 * water_pixels / valid_pixels
    )

    # ======================================
    # Generate Transparent Overlay
    # ======================================

    overlay = build_ndwi_overlay(
        ndwi,
        best_result["crs"],
        best_result["transform"],
    )

    # ======================================
    # Backend Logs
    # ======================================

    print(
        "\n========== GeoPulse NDWI =========="
    )

    print(
        "Selected scene:",
        scene.id,
    )

    print(
        "Valid pixel coverage:",
        round(
            best_result["valid_percentage"],
            2,
        ),
        "%",
    )

    print(
        "Water percentage:",
        round(water_percentage, 2),
        "%",
    )

    print(
        "Coverage diagnostics:",
        best_result["diagnostics"],
    )

    print(
        "===================================\n"
    )

    # ======================================
    # API Response
    # ======================================

    return {
        "status": "success",
        "analysis": "NDWI Water Detection",
        "source": "Element 84 Earth Search",
        "satellite": "Sentinel-2 Level-2A",
        "scene_id": scene.id,
        "acquisition_date": (
            scene.datetime.isoformat()
            if scene.datetime
            else None
        ),
        "scene_cloud_cover": (
            scene.properties.get(
                "eo:cloud_cover"
            )
        ),
        "mean_ndwi": round(
            float(np.mean(valid_values)),
            4,
        ),
        "min_ndwi": round(
            float(np.min(valid_values)),
            4,
        ),
        "max_ndwi": round(
            float(np.max(valid_values)),
            4,
        ),
        "water_pixels": water_pixels,
        "water_percentage": round(
            water_percentage,
            2,
        ),
        "valid_pixels": valid_pixels,
        "total_pixels": total_pixels,
        "valid_pixel_percentage": round(
            best_result["valid_percentage"],
            2,
        ),
        "water_threshold": WATER_THRESHOLD,
        "cloud_masked": True,
        "overlay": overlay,
        "coverage_diagnostics": (
            best_result["diagnostics"]
        ),
        "scene_candidates": candidates,
        "scenes_evaluated": len(candidates),
        "message": (
            "NDWI calculated from real Sentinel-2 "
            "Green and NIR bands. The scene was "
            "selected based on usable pixel coverage "
            "within the requested study area. "
            "Non-water pixels are transparent in "
            "the overlay. Water detection is an estimate."
        ),
    }
