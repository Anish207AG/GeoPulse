
"""
GeoPulse - Step 22.1
Before-and-After Satellite Index Comparison

Creates geographically aligned NDVI or NDWI
images from real Sentinel-2 Level-2A observations.

Uses the existing change_detection.py module.
"""

import base64
from io import BytesIO

import numpy as np
from PIL import Image

from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.transform import array_bounds
from rasterio.warp import (
    calculate_default_transform,
    reproject,
)

from change_detection import (
    MAX_PIXELS,
    select_best_scene,
    prepare_index_array,
    align_raster,
)


def colorize_index(values, valid_mask, index_type):
    """
    Convert NDVI or NDWI values into an RGBA image.

    Invalid pixels are transparent.
    Both dates use the same fixed color scale.
    """

    height, width = values.shape

    rgba = np.zeros(
        (height, width, 4),
        dtype=np.uint8,
    )

    valid = (
        valid_mask
        & np.isfinite(values)
        & (values >= -1)
        & (values <= 1)
    )

    if index_type == "NDVI":
        # Brown: low NDVI
        low = valid & (values < 0.2)
        rgba[low] = [166, 115, 65, 220]

        # Yellow: moderate-low NDVI
        moderate = (
            valid
            & (values >= 0.2)
            & (values < 0.4)
        )
        rgba[moderate] = [234, 202, 82, 220]

        # Light green: moderate NDVI
        green = (
            valid
            & (values >= 0.4)
            & (values < 0.6)
        )
        rgba[green] = [113, 190, 83, 220]

        # Dark green: high NDVI
        high = valid & (values >= 0.6)
        rgba[high] = [25, 115, 58, 220]

    elif index_type == "NDWI":
        # Brown: negative NDWI
        negative = valid & (values <= 0)
        rgba[negative] = [171, 145, 109, 190]

        # Light blue: weak positive NDWI
        low_water = (
            valid
            & (values > 0)
            & (values <= 0.2)
        )
        rgba[low_water] = [125, 211, 252, 220]

        # Medium blue
        medium_water = (
            valid
            & (values > 0.2)
            & (values <= 0.4)
        )
        rgba[medium_water] = [37, 150, 235, 220]

        # Dark blue: strong positive NDWI
        high_water = valid & (values > 0.4)
        rgba[high_water] = [25, 74, 180, 230]

    else:
        raise ValueError(
            "index_type must be NDVI or NDWI."
        )

    return rgba


def create_geographic_overlay(
    values,
    valid_mask,
    raster_crs,
    raster_transform,
    index_type,
):
    """
    Reproject the index image to EPSG:4326
    for display using React Leaflet.
    """

    height, width = values.shape

    if height * width > MAX_PIXELS:
        raise ValueError(
            "Satellite comparison exceeds pixel limit."
        )

    rgba = colorize_index(
        values,
        valid_mask,
        index_type,
    )

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
            "Geographic comparison overlay is too large."
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
            [float(south), float(west)],
            [float(north), float(east)],
        ],
        "width": destination_width,
        "height": destination_height,
        "crs": "EPSG:4326",
        "opacity": 0.8,
    }


def calculate_satellite_comparison(
    bbox,
    before_start_date,
    before_end_date,
    after_start_date,
    after_end_date,
    index_type="NDVI",
    max_cloud_cover=30,
):
    """
    Select real Sentinel-2 observations,
    align their index rasters, and create
    before/after comparison overlays.
    """

    index_type = index_type.upper()

    if index_type not in ("NDVI", "NDWI"):
        raise ValueError(
            "Choose NDVI or NDWI."
        )

    if before_start_date > before_end_date:
        raise ValueError(
            "Invalid before date range."
        )

    if after_start_date > after_end_date:
        raise ValueError(
            "Invalid after date range."
        )

    if before_end_date >= after_start_date:
        raise ValueError(
            "Before and after periods must not overlap."
        )

    print(
        "\n========== GeoPulse Comparison =========="
    )
    print("Index:", index_type)

    before_selection = select_best_scene(
        bbox,
        before_start_date,
        before_end_date,
        max_cloud_cover,
        index_type,
    )

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

    # Put AFTER values onto BEFORE's raster grid.
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

    # Use only pixels valid in both observations.
    common_valid = (
        before_valid
        & aligned_after_valid
    )

    common_valid_pixels = int(
        np.count_nonzero(common_valid)
    )

    total_pixels = int(common_valid.size)

    if common_valid_pixels == 0:
        raise ValueError(
            "No overlapping valid satellite pixels."
        )

    common_coverage = (
        100 * common_valid_pixels / total_pixels
    )

    before_overlay = create_geographic_overlay(
        before_values,
        common_valid,
        before_result["crs"],
        before_result["transform"],
        index_type,
    )

    after_overlay = create_geographic_overlay(
        aligned_after,
        common_valid,
        before_result["crs"],
        before_result["transform"],
        index_type,
    )

    before_scene = before_result["scene"]
    after_scene = after_result["scene"]

    before_mean = float(
        np.mean(before_values[common_valid])
    )

    after_mean = float(
        np.mean(aligned_after[common_valid])
    )

    if index_type == "NDVI":
        legend = [
            {"label": "Below 0.2", "color": "#a67341"},
            {"label": "0.2 to 0.4", "color": "#eaca52"},
            {"label": "0.4 to 0.6", "color": "#71be53"},
            {"label": "0.6 and above", "color": "#19733a"},
        ]
    else:
        legend = [
            {"label": "NDWI <= 0", "color": "#ab916d"},
            {"label": "0 to 0.2", "color": "#7dd3fc"},
            {"label": "0.2 to 0.4", "color": "#2596eb"},
            {"label": "Above 0.4", "color": "#194ab4"},
        ]

    print("Before:", before_scene.id)
    print("After:", after_scene.id)
    print(
        "Common valid pixels:",
        common_valid_pixels,
    )
    print(
        "========================================\n"
    )

    return {
        "status": "success",
        "analysis": "Before and After Satellite Comparison",
        "satellite": "Sentinel-2 Level-2A",
        "source": "Element 84 Earth Search",
        "index_type": index_type,
        "before": {
            "scene_id": before_scene.id,
            "acquisition_date": (
                before_scene.datetime.isoformat()
                if before_scene.datetime
                else None
            ),
            "cloud_cover": before_scene.properties.get(
                "eo:cloud_cover"
            ),
            "mean_index": round(before_mean, 4),
            "overlay": before_overlay,
            "scenes_evaluated": len(
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
            "cloud_cover": after_scene.properties.get(
                "eo:cloud_cover"
            ),
            "mean_index": round(after_mean, 4),
            "overlay": after_overlay,
            "scenes_evaluated": len(
                after_selection["candidates"]
            ),
        },
        "statistics": {
            "mean_change": round(
                after_mean - before_mean,
                4,
            ),
            "common_valid_pixels": (
                common_valid_pixels
            ),
            "total_pixels": total_pixels,
            "common_valid_percentage": round(
                common_coverage,
                2,
            ),
        },
        "legend": legend,
        "message": (
            "Both index overlays use the same raster "
            "grid and geographic extent. Colors "
            "represent NDVI or NDWI values, not "
            "natural-color satellite photography "
            "or independently verified land cover."
        ),
    }


if __name__ == "__main__":
    print(
        "GeoPulse satellite comparison module loaded."
    )
    print("Supported indices: NDVI, NDWI")
