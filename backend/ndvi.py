
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
# GeoPulse NDVI Configuration
# ==========================================

CATALOG_URL = "https://earth-search.aws.element84.com/v1"
COLLECTION = "sentinel-2-l2a"

MAX_PIXELS = 4_000_000
MAX_SCENES = 10

VEGETATION_THRESHOLD = 0.3

# Sentinel-2 Scene Classification Layer:
# 0 = No data
# 1 = Saturated or defective
# 3 = Cloud shadow
# 8 = Medium-probability cloud
# 9 = High-probability cloud
# 10 = Thin cirrus
# 11 = Snow or ice

INVALID_SCL_CLASSES = [0, 1, 3, 8, 9, 10, 11]


# ==========================================
# Read Satellite Band
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

            # Keep the complete requested window.
            # Do not silently crop to the satellite
            # footprint, because that would hide
            # missing coverage.
            col_start = int(np.floor(requested_window.col_off))
            row_start = int(np.floor(requested_window.row_off))

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
                    "Invalid study area raster dimensions."
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
                fill_value=src.nodata
                if src.nodata is not None
                else 0,
            )

            return {
                "data": data,
                "crs": src.crs,
                "transform": src.window_transform(window),
                "shape": data.shape,
            }

        if target_transform is None or target_shape is None:
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
# Process One Satellite Scene
# ==========================================

def process_scene(scene, bbox):

    for asset_name in ("red", "nir", "scl"):
        if asset_name not in scene.assets:
            raise ValueError(
                f"Missing {asset_name} asset."
            )

    # Red band provides the reference grid.
    red_band = read_band(
        scene.assets["red"].href,
        bbox,
    )

    red = red_band["data"].astype(np.float32)

    target_crs = red_band["crs"]
    target_transform = red_band["transform"]
    target_shape = red_band["shape"]

    # Align NIR to the Red band.
    nir_band = read_band(
        scene.assets["nir"].href,
        bbox,
        target_crs=target_crs,
        target_transform=target_transform,
        target_shape=target_shape,
        resampling=Resampling.bilinear,
    )

    nir = nir_band["data"].astype(np.float32)

    # Align SCL using nearest-neighbor
    # to preserve its classification codes.
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
    # Diagnose Invalid Pixels
    # ======================================

    red_missing = np.ma.getmaskarray(red)
    nir_missing = np.ma.getmaskarray(nir)
    scl_missing = np.ma.getmaskarray(scl)

    missing_band = (
        red_missing
        | nir_missing
        | scl_missing
    )

    scl_values = np.ma.filled(scl, 0).astype(
        np.uint8
    )

    invalid_scl = np.isin(
        scl_values,
        INVALID_SCL_CLASSES,
    )

    red_values = np.ma.filled(
        red,
        0,
    ).astype(np.float32)

    nir_values = np.ma.filled(
        nir,
        0,
    ).astype(np.float32)

    denominator = red_values + nir_values

    invalid_denominator = (
        ~np.isfinite(denominator)
        | (denominator <= 0)
    )

    with np.errstate(
        divide="ignore",
        invalid="ignore",
    ):
        ndvi_values = (
            nir_values - red_values
        ) / np.where(
            denominator == 0,
            1,
            denominator,
        )

    invalid_ndvi = (
        ~np.isfinite(ndvi_values)
        | (ndvi_values < -1)
        | (ndvi_values > 1)
    )

    invalid = (
        missing_band
        | invalid_scl
        | invalid_denominator
        | invalid_ndvi
    )

    ndvi = np.ma.array(
        ndvi_values,
        mask=invalid,
    )

    total_pixels = int(ndvi.size)
    valid_pixels = int(
        np.count_nonzero(~invalid)
    )

    valid_percentage = (
        100 * valid_pixels / total_pixels
        if total_pixels
        else 0
    )

    # These diagnostic categories can overlap.
    # Their counts should not be added together.
    diagnostics = {
        "red_band_missing_pixels": int(
            np.count_nonzero(red_missing)
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
            np.count_nonzero(invalid_scl & ~missing_band)
        ),
        "invalid_denominator_pixels": int(
            np.count_nonzero(
                invalid_denominator & ~missing_band
            )
        ),
        "invalid_ndvi_pixels": int(
            np.count_nonzero(
                invalid_ndvi & ~missing_band
            )
        ),
        "total_invalid_pixels": int(
            np.count_nonzero(invalid)
        ),
        "scl_class_counts": {},
    }

    # Count SCL classes only where the SCL
    # band itself has data.
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
        "ndvi": ndvi,
        "crs": target_crs,
        "transform": target_transform,
        "total_pixels": total_pixels,
        "valid_pixels": valid_pixels,
        "valid_percentage": valid_percentage,
        "diagnostics": diagnostics,
    }


# ==========================================
# Create Geographic NDVI Overlay
# ==========================================

def build_ndvi_overlay(
    ndvi,
    raster_crs,
    raster_transform,
):

    values = np.ma.filled(
        ndvi,
        np.nan,
    ).astype(np.float32)

    height, width = values.shape

    rgba = np.zeros(
        (height, width, 4),
        dtype=np.uint8,
    )

    valid = np.isfinite(values)

    negative = valid & (values < 0)

    low = (
        valid
        & (values >= 0)
        & (values < 0.2)
    )

    moderate = (
        valid
        & (values >= 0.2)
        & (values < 0.4)
    )

    high = (
        valid
        & (values >= 0.4)
        & (values < 0.6)
    )

    very_high = valid & (values >= 0.6)

    rgba[negative] = [37, 99, 235, 190]
    rgba[low] = [161, 98, 7, 190]
    rgba[moderate] = [234, 179, 8, 190]
    rgba[high] = [132, 204, 22, 190]
    rgba[very_high] = [21, 128, 61, 190]

    # Invalid pixels remain transparent.

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
            "NDVI overlay is too large."
        )

    projected = np.zeros(
        (
            destination_height,
            destination_width,
            4,
        ),
        dtype=np.uint8,
    )

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

    image = Image.fromarray(
        projected,
        mode="RGBA",
    )

    buffer = BytesIO()
    image.save(buffer, format="PNG")

    encoded = base64.b64encode(
        buffer.getvalue()
    ).decode("utf-8")

    west, south, east, north = array_bounds(
        destination_height,
        destination_width,
        destination_transform,
    )

    return {
        "image": "data:image/png;base64," + encoded,
        "bounds": [
            [south, west],
            [north, east],
        ],
        "width": destination_width,
        "height": destination_height,
        "opacity": 0.75,
        "legend": [
            {
                "label": "Negative NDVI",
                "color": "#2563eb",
            },
            {
                "label": "0 to 0.2",
                "color": "#a16207",
            },
            {
                "label": "0.2 to 0.4",
                "color": "#eab308",
            },
            {
                "label": "0.4 to 0.6",
                "color": "#84cc16",
            },
            {
                "label": "0.6 to 1.0",
                "color": "#15803d",
            },
        ],
    }


# ==========================================
# Calculate NDVI Using Best Available Scene
# ==========================================

def calculate_ndvi(
    bbox,
    start_date,
    end_date,
    max_cloud_cover=30,
):

    catalog = Client.open(CATALOG_URL)

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

    # Evaluate least-cloudy candidates first.
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

    for scene in scenes:

        try:
            result = process_scene(
                scene,
                bbox,
            )

            coverage = result["valid_percentage"]

            candidates.append({
                "scene_id": scene.id,
                "scene_cloud_cover": (
                    scene.properties.get(
                        "eo:cloud_cover"
                    )
                ),
                "valid_pixel_percentage": round(
                    coverage,
                    2,
                ),
                "valid_pixels": result["valid_pixels"],
                "total_pixels": result["total_pixels"],
                "status": "evaluated",
            })

            # Prefer more usable coverage.
            # Break ties using valid pixel count.
            score = (
                coverage,
                result["valid_pixels"],
            )

            if score > best_score:
                best_score = score
                best_result = result

        except Exception as error:
            print(
                f"NDVI scene {scene.id} failed:",
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
            "No valid pixels found in the available "
            "satellite scenes. Try another date range."
        )

    scene = best_result["scene"]
    ndvi = best_result["ndvi"]

    valid_values = ndvi.compressed()

    vegetation_pixels = int(
        np.count_nonzero(
            valid_values > VEGETATION_THRESHOLD
        )
    )

    valid_pixels = best_result["valid_pixels"]
    total_pixels = best_result["total_pixels"]

    vegetation_percentage = (
        vegetation_pixels / valid_pixels
    ) * 100

    overlay = build_ndvi_overlay(
        ndvi,
        best_result["crs"],
        best_result["transform"],
    )

    print("\n========== GeoPulse NDVI ==========")
    print("Selected scene:", scene.id)
    print(
        "Valid pixel coverage:",
        round(best_result["valid_percentage"], 2),
        "%",
    )
    print(
        "Coverage diagnostics:",
        best_result["diagnostics"],
    )
    print("===================================\n")

    return {
        "status": "success",
        "analysis": "NDVI Vegetation Analysis",
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
        "mean_ndvi": round(
            float(np.mean(valid_values)),
            4,
        ),
        "min_ndvi": round(
            float(np.min(valid_values)),
            4,
        ),
        "max_ndvi": round(
            float(np.max(valid_values)),
            4,
        ),
        "vegetation_pixels": vegetation_pixels,
        "vegetation_percentage": round(
            vegetation_percentage,
            2,
        ),
        "valid_pixels": valid_pixels,
        "total_pixels": total_pixels,
        "valid_pixel_percentage": round(
            best_result["valid_percentage"],
            2,
        ),
        "cloud_masked": True,
        "vegetation_threshold": VEGETATION_THRESHOLD,
        "overlay": overlay,
        "coverage_diagnostics": (
            best_result["diagnostics"]
        ),
        "scene_candidates": candidates,
        "scenes_evaluated": len(candidates),
        "message": (
            "NDVI calculated from real Sentinel-2 "
            "Red and NIR bands. The scene was selected "
            "based on usable pixel coverage within "
            "the requested study area."
        ),
    }
