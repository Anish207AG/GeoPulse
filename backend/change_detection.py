
"""
GeoPulse - Step 21
Real Sentinel-2 Satellite Change Detection

Compares NDVI or NDWI across two date ranges.

Dependencies:
    numpy
    rasterio
    pillow
    pystac-client

Existing GeoPulse modules:
    ndvi.py
    ndwi.py
"""

import base64
import time
from io import BytesIO

import numpy as np

from PIL import Image
from pystac_client import Client

from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.transform import array_bounds
from rasterio.warp import (
    calculate_default_transform,
    reproject,
)


# ==========================================
# Configuration
# ==========================================

CATALOG_URL = "https://earth-search.aws.element84.com/v1"

COLLECTION = "sentinel-2-l2a"

MAX_SCENES = 10
MAX_PIXELS = 4_000_000

# Meaningful change threshold for index values.
# This is configurable, not a validated
# land-cover classification threshold.

DEFAULT_CHANGE_THRESHOLD = 0.15


# ==========================================
# Scene Search
# ==========================================

def search_scenes(
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

    return scenes


# ==========================================
# Process Satellite Scene
# ==========================================

def process_index_scene(
    scene,
    bbox,
    index_type,
):
    if index_type == "NDVI":
        from ndvi import process_scene

        result = process_scene(scene, bbox)
        index_key = "ndvi"

    elif index_type == "NDWI":
        from ndwi import process_scene

        result = process_scene(scene, bbox)
        index_key = "ndwi"

    else:
        raise ValueError(
            "index_type must be NDVI or NDWI."
        )

    if index_key not in result:
        raise ValueError(
            f"Missing '{index_key}' in "
            "satellite processing result."
        )

    return result, index_key


# ==========================================
# Select Best Scene for a Period
# ==========================================

def select_best_scene(
    bbox,
    start_date,
    end_date,
    max_cloud_cover,
    index_type,
):
    scenes = search_scenes(
        bbox,
        start_date,
        end_date,
        max_cloud_cover,
    )

    if not scenes:
        raise ValueError(
            "No Sentinel-2 scenes found for "
            f"{start_date} to {end_date}."
        )

    best_result = None
    best_score = (-1, -1)

    candidates = []

    for scene in scenes:
        scene_start = time.perf_counter()
        print(
            f"[GeoPulse] Processing {index_type} scene: {scene.id}",
            flush=True,
        )
        try:
            result, index_key = (
                process_index_scene(
                    scene,
                    bbox,
                    index_type,
                )
            )

            print(
                f"[GeoPulse] Scene {scene.id} processed in "
                f"{time.perf_counter() - scene_start:.2f} seconds",
                flush=True,
            )

            coverage = float(
                result["valid_percentage"]
            )

            valid_pixels = int(
                result["valid_pixels"]
            )

            score = (
                coverage,
                valid_pixels,
            )

            candidates.append({
                "scene_id": scene.id,
                "cloud_cover": (
                    scene.properties.get(
                        "eo:cloud_cover"
                    )
                ),
                "valid_pixel_percentage": round(
                    coverage, 2
                ),
                "status": "evaluated",
            })

            if (
                valid_pixels > 0
                and score > best_score
            ):
                best_score = score
                best_result = result

        except Exception as error:
            print(
                f"[GeoPulse] Scene {scene.id} failed after "
                f"{time.perf_counter() - scene_start:.2f} seconds",
                flush=True,
            )
            print(
                "Change detection scene failed:",
                scene.id,
                str(error),
            )

            candidates.append({
                "scene_id": scene.id,
                "status": "failed",
                "reason": str(error),
            })

    if best_result is None:
        raise ValueError(
            "No usable satellite scene found "
            f"for {start_date} to {end_date}."
        )

    return {
        "result": best_result,
        "candidates": candidates,
    }


# ==========================================
# Convert Masked Index to Float Array
# ==========================================

def prepare_index_array(index_data):
    values = np.ma.filled(
        index_data,
        np.nan,
    ).astype(np.float32)

    valid = (
        np.isfinite(values)
        & (values >= -1)
        & (values <= 1)
    )

    return values, valid


# ==========================================
# Align Second Satellite Raster to First
# ==========================================

def align_raster(
    source_values,
    source_valid,
    source_crs,
    source_transform,
    target_crs,
    target_transform,
    target_shape,
):
    target_height, target_width = target_shape

    aligned_values = np.full(
        target_shape,
        np.nan,
        dtype=np.float32,
    )

    # Reproject the data with nearest-neighbor
    # to avoid interpolating across invalid pixels.

    reproject(
        source=source_values,
        destination=aligned_values,
        src_transform=source_transform,
        src_crs=source_crs,
        src_nodata=np.nan,
        dst_transform=target_transform,
        dst_crs=target_crs,
        dst_nodata=np.nan,
        resampling=Resampling.nearest,
    )

    # Reproject validity separately.

    aligned_valid = np.zeros(
        (target_height, target_width),
        dtype=np.uint8,
    )

    reproject(
        source=source_valid.astype(np.uint8),
        destination=aligned_valid,
        src_transform=source_transform,
        src_crs=source_crs,
        src_nodata=0,
        dst_transform=target_transform,
        dst_crs=target_crs,
        dst_nodata=0,
        resampling=Resampling.nearest,
    )

    valid = (
        (aligned_valid == 1)
        & np.isfinite(aligned_values)
    )

    return aligned_values, valid


# ==========================================
# Build Geographic Change Overlay
# ==========================================

def build_change_overlay(
    change_values,
    valid_mask,
    raster_crs,
    raster_transform,
    threshold,
):
    height, width = change_values.shape

    rgba = np.zeros(
        (height, width, 4),
        dtype=np.uint8,
    )

    increase = (
        valid_mask
        & (change_values >= threshold)
    )

    decrease = (
        valid_mask
        & (change_values <= -threshold)
    )

    # Green: index increased
    rgba[increase] = [
        34, 197, 94, 220
    ]

    # Red: index decreased
    rgba[decrease] = [
        239, 68, 68, 220
    ]

    # Unchanged and invalid remain transparent.

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
            "Change overlay exceeds size limit."
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

    image = Image.fromarray(projected)

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
        "opacity": 0.8,
        "legend": [
            {
                "label": "Index Increased",
                "color": "#22c55e",
            },
            {
                "label": "Index Decreased",
                "color": "#ef4444",
            },
            {
                "label": "No Significant Change",
                "color": "transparent",
            },
        ],
    }


# ==========================================
# Main Change Detection Function
# ==========================================

def calculate_change_detection(
    bbox,
    before_start_date,
    before_end_date,
    after_start_date,
    after_end_date,
    index_type="NDVI",
    max_cloud_cover=30,
    change_threshold=DEFAULT_CHANGE_THRESHOLD,
):
    index_type = index_type.upper()

    if index_type not in ("NDVI", "NDWI"):
        raise ValueError(
            "Choose NDVI or NDWI."
        )

    if (
        not np.isfinite(change_threshold)
        or change_threshold <= 0
        or change_threshold > 2
    ):
        raise ValueError(
            "change_threshold must be "
            "greater than 0 and at most 2."
        )

    if before_start_date > before_end_date:
        raise ValueError(
            "Invalid before date range."
        )

    if after_start_date > after_end_date:
        raise ValueError(
            "Invalid after date range."
        )

    print(
        "\n========== GeoPulse Change Detection =========="
    )

    print("Index:", index_type)
    print("Searching BEFORE period...")

    before_selection = select_best_scene(
        bbox,
        before_start_date,
        before_end_date,
        max_cloud_cover,
        index_type,
    )

    print("Searching AFTER period...")

    after_selection = select_best_scene(
        bbox,
        after_start_date,
        after_end_date,
        max_cloud_cover,
        index_type,
    )

    before_result = before_selection["result"]
    after_result = after_selection["result"]

    index_key = index_type.lower()

    before_values, before_valid = (
        prepare_index_array(
            before_result[index_key]
        )
    )

    after_values, after_valid = (
        prepare_index_array(
            after_result[index_key]
        )
    )

    # ======================================
    # Align After Raster to Before Raster
    # ======================================

    aligned_after, aligned_after_valid = (
        align_raster(
            source_values=after_values,
            source_valid=after_valid,
            source_crs=after_result["crs"],
            source_transform=after_result["transform"],
            target_crs=before_result["crs"],
            target_transform=before_result["transform"],
            target_shape=before_values.shape,
        )
    )

    # ======================================
    # Common Valid Pixels
    # ======================================

    common_valid = (
        before_valid
        & aligned_after_valid
    )

    total_pixels = int(
        common_valid.size
    )

    common_valid_pixels = int(
        np.count_nonzero(common_valid)
    )

    if common_valid_pixels == 0:
        raise ValueError(
            "No overlapping valid satellite pixels "
            "were found between the two dates."
        )

    common_valid_percentage = (
        100
        * common_valid_pixels
        / total_pixels
    )

    # ======================================
    # Calculate Index Difference
    # ======================================

    difference = np.full(
        before_values.shape,
        np.nan,
        dtype=np.float32,
    )

    difference[common_valid] = (
        aligned_after[common_valid]
        - before_values[common_valid]
    )

    valid_differences = difference[
        common_valid
    ]

    # ======================================
    # Change Statistics
    # ======================================

    increase_pixels = int(
        np.count_nonzero(
            valid_differences >= change_threshold
        )
    )

    decrease_pixels = int(
        np.count_nonzero(
            valid_differences <= -change_threshold
        )
    )

    unchanged_pixels = (
        common_valid_pixels
        - increase_pixels
        - decrease_pixels
    )

    increase_percentage = (
        100 * increase_pixels
        / common_valid_pixels
    )

    decrease_percentage = (
        100 * decrease_pixels
        / common_valid_pixels
    )

    unchanged_percentage = (
        100 * unchanged_pixels
        / common_valid_pixels
    )

    mean_before = float(
        np.mean(
            before_values[common_valid]
        )
    )

    mean_after = float(
        np.mean(
            aligned_after[common_valid]
        )
    )

    mean_change = float(
        np.mean(valid_differences)
    )

    # ======================================
    # NDWI Possible-Water Transition Counts
    # ======================================

    water_statistics = None

    if index_type == "NDWI":
        before_water = (
            before_values[common_valid] > 0
        )

        after_water = (
            aligned_after[common_valid] > 0
        )

        gained_water_pixels = int(
            np.count_nonzero(
                ~before_water & after_water
            )
        )

        lost_water_pixels = int(
            np.count_nonzero(
                before_water & ~after_water
            )
        )

        water_statistics = {
            "before_possible_water_pixels": int(
                np.count_nonzero(before_water)
            ),
            "after_possible_water_pixels": int(
                np.count_nonzero(after_water)
            ),
            "gained_possible_water_pixels": (
                gained_water_pixels
            ),
            "lost_possible_water_pixels": (
                lost_water_pixels
            ),
            "net_possible_water_pixel_change": (
                gained_water_pixels
                - lost_water_pixels
            ),
        }

    # ======================================
    # Generate Change Map
    # ======================================

    overlay = build_change_overlay(
        difference,
        common_valid,
        before_result["crs"],
        before_result["transform"],
        change_threshold,
    )

    before_scene = before_result["scene"]
    after_scene = after_result["scene"]

    print("Before scene:", before_scene.id)
    print("After scene:", after_scene.id)

    print(
        "Common valid coverage:",
        round(common_valid_percentage, 2),
        "%",
    )

    print(
        "Mean index change:",
        round(mean_change, 4),
    )

    print(
        "==============================================\n"
    )

    # ======================================
    # API Response
    # ======================================

    return {
        "status": "success",
        "analysis": (
            f"{index_type} Satellite Change Detection"
        ),
        "source": "Element 84 Earth Search",
        "satellite": "Sentinel-2 Level-2A",
        "index_type": index_type,
        "change_threshold": change_threshold,
        "before": {
            "scene_id": before_scene.id,
            "acquisition_date": (
                before_scene.datetime.isoformat()
                if before_scene.datetime
                else None
            ),
            "cloud_cover": (
                before_scene.properties.get(
                    "eo:cloud_cover"
                )
            ),
            "mean_index": round(
                mean_before, 4
            ),
            "valid_pixel_percentage": round(
                before_result["valid_percentage"],
                2,
            ),
            "scenes_evaluated": len(
                before_selection["candidates"]
            ),
            "scene_candidates": (
                before_selection["candidates"]
            ),
        },
        "after": {
            "scene_id": after_scene.id,
            "acquisition_date": (
                after_scene.datetime.isoformat()
                if after_scene.datetime
                else None
            ),
            "cloud_cover": (
                after_scene.properties.get(
                    "eo:cloud_cover"
                )
            ),
            "mean_index": round(
                mean_after, 4
            ),
            "valid_pixel_percentage": round(
                after_result["valid_percentage"],
                2,
            ),
            "scenes_evaluated": len(
                after_selection["candidates"]
            ),
            "scene_candidates": (
                after_selection["candidates"]
            ),
        },
        "statistics": {
            "mean_before": round(
                mean_before, 4
            ),
            "mean_after": round(
                mean_after, 4
            ),
            "mean_change": round(
                mean_change, 4
            ),
            "min_change": round(
                float(np.min(valid_differences)),
                4,
            ),
            "max_change": round(
                float(np.max(valid_differences)),
                4,
            ),
            "increase_pixels": increase_pixels,
            "decrease_pixels": decrease_pixels,
            "unchanged_pixels": unchanged_pixels,
            "increase_percentage": round(
                increase_percentage, 2
            ),
            "decrease_percentage": round(
                decrease_percentage, 2
            ),
            "unchanged_percentage": round(
                unchanged_percentage, 2
            ),
            "common_valid_pixels": (
                common_valid_pixels
            ),
            "total_pixels": total_pixels,
            "common_valid_percentage": round(
                common_valid_percentage, 2
            ),
        },
        "water_statistics": water_statistics,
        "overlay": overlay,
        "message": (
            "Change detection calculated using "
            "real Sentinel-2 imagery. "
            "The two selected scenes were aligned "
            "to a common raster grid. "
            "Statistics use pixels valid on both "
            "dates. Results represent changes "
            "in satellite spectral indices, "
            "not verified land-cover changes."
        ),
    }


# ==========================================
# Local Import Check
# ==========================================

if __name__ == "__main__":
    print(
        "GeoPulse Change Detection module loaded."
    )
    print(
        "Supported indices: NDVI, NDWI"
    )
    print(
        "Run through FastAPI after integration."
    )
