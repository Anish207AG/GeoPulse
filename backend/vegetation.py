
"""
GeoPulse - Step 23
Potential Vegetation Loss and Gain Detection

Uses real Sentinel-2 Level-2A NDVI observations.

This module reuses existing functions from
change_detection.py without modifying them.

Classification:
    NDVI >= threshold: vegetation signal
    NDVI < threshold: non-vegetation signal

Transitions:
    Vegetation -> Non-vegetation: Potential loss
    Non-vegetation -> Vegetation: Potential gain

Important:
    These are spectral-index transitions, not
    independently verified land-cover changes.
"""

import numpy as np

from change_detection import (
    select_best_scene,
    prepare_index_array,
    align_raster,
    build_change_overlay,
)


DEFAULT_VEGETATION_THRESHOLD = 0.3

MAX_VEGETATION_PIXELS = 4_000_000


# ==========================================
# Input Validation
# ==========================================

def validate_vegetation_inputs(
    bbox,
    before_start_date,
    before_end_date,
    after_start_date,
    after_end_date,
    vegetation_threshold,
    max_cloud_cover,
):
    if len(bbox) != 4:
        raise ValueError(
            "Bounding box must contain four coordinates."
        )

    west, south, east, north = bbox

    if not all(np.isfinite(bbox)):
        raise ValueError(
            "Bounding box coordinates must be finite."
        )

    if not (
        -180 <= west < east <= 180
        and -90 <= south < north <= 90
    ):
        raise ValueError(
            "Invalid geographical bounding box."
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
            "Before period must end before after period."
        )

    if (
        not np.isfinite(vegetation_threshold)
        or vegetation_threshold < -1
        or vegetation_threshold > 1
    ):
        raise ValueError(
            "Vegetation threshold must be between -1 and 1."
        )

    if (
        not np.isfinite(max_cloud_cover)
        or max_cloud_cover < 0
        or max_cloud_cover > 100
    ):
        raise ValueError(
            "Cloud cover must be between 0 and 100."
        )


# ==========================================
# Pixel Area Calculation
# ==========================================

def calculate_pixel_area(transform, crs):
    """
    Returns pixel area in square metres.

    Sentinel-2 typically uses a projected
    coordinate system with metre units.

    The affine determinant accounts for
    pixel dimensions and possible rotation.
    """

    if not crs.is_projected:
        raise ValueError(
            "Area estimation requires a projected "
            "coordinate reference system."
        )

    units = str(crs.linear_units).lower()

    if units not in (
        "metre",
        "meter",
        "metres",
        "meters",
        "m",
    ):
        raise ValueError(
            "Area estimation requires metre-based "
            "projected coordinates."
        )

    pixel_area = abs(
        transform.a * transform.e
        - transform.b * transform.d
    )

    if not np.isfinite(pixel_area) or pixel_area <= 0:
        raise ValueError(
            "Invalid satellite pixel area."
        )

    return float(pixel_area)


# ==========================================
# Percentage Helper
# ==========================================

def percentage(count, total):
    if total <= 0:
        return 0.0

    return round(
        100.0 * count / total,
        2,
    )


# ==========================================
# Area Statistics Helper
# ==========================================

def area_statistics(pixel_count, pixel_area_m2):
    area_m2 = pixel_count * pixel_area_m2

    return {
        "pixels": int(pixel_count),
        "area_hectares": round(
            area_m2 / 10000,
            4,
        ),
        "area_sq_km": round(
            area_m2 / 1000000,
            6,
        ),
    }


# ==========================================
# Main Vegetation Detection Function
# ==========================================

def calculate_vegetation_change(
    bbox,
    before_start_date,
    before_end_date,
    after_start_date,
    after_end_date,
    max_cloud_cover=30,
    vegetation_threshold=DEFAULT_VEGETATION_THRESHOLD,
):
    """
    Compare vegetation-state transitions
    between two Sentinel-2 NDVI observations.
    """

    validate_vegetation_inputs(
        bbox=bbox,
        before_start_date=before_start_date,
        before_end_date=before_end_date,
        after_start_date=after_start_date,
        after_end_date=after_end_date,
        vegetation_threshold=vegetation_threshold,
        max_cloud_cover=max_cloud_cover,
    )

    print(
        "\n========== GeoPulse Vegetation Detection =========="
    )

    print(
        "NDVI vegetation threshold:",
        vegetation_threshold,
    )

    # ======================================
    # Select Before Satellite Scene
    # ======================================

    print("Selecting BEFORE satellite scene...")

    before_selection = select_best_scene(
        bbox=bbox,
        start_date=before_start_date,
        end_date=before_end_date,
        max_cloud_cover=max_cloud_cover,
        index_type="NDVI",
    )

    # ======================================
    # Select After Satellite Scene
    # ======================================

    print("Selecting AFTER satellite scene...")

    after_selection = select_best_scene(
        bbox=bbox,
        start_date=after_start_date,
        end_date=after_end_date,
        max_cloud_cover=max_cloud_cover,
        index_type="NDVI",
    )

    before_result = before_selection["result"]
    after_result = after_selection["result"]

    # ======================================
    # Prepare NDVI Arrays
    # ======================================

    before_values, before_valid = (
        prepare_index_array(
            before_result["ndvi"]
        )
    )

    after_values, after_valid = (
        prepare_index_array(
            after_result["ndvi"]
        )
    )

    if before_values.size > MAX_VEGETATION_PIXELS:
        raise ValueError(
            "Study area is too large for vegetation "
            "analysis. Select a smaller area."
        )

    # ======================================
    # Align After Image to Before Image
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
    # Identify Common Valid Pixels
    # ======================================

    common_valid = (
        before_valid
        & aligned_after_valid
    )

    total_pixels = int(common_valid.size)

    common_valid_pixels = int(
        np.count_nonzero(common_valid)
    )

    if common_valid_pixels == 0:
        raise ValueError(
            "No overlapping valid pixels were found."
        )

    # ======================================
    # Classify Vegetation Signal
    # ======================================

    before_vegetation = (
        common_valid
        & (before_values >= vegetation_threshold)
    )

    after_vegetation = (
        common_valid
        & (aligned_after >= vegetation_threshold)
    )

    # ======================================
    # Detect Vegetation Transitions
    # ======================================

    vegetation_loss = (
        before_vegetation
        & ~after_vegetation
    )

    vegetation_gain = (
        ~before_vegetation
        & after_vegetation
        & common_valid
    )

    stable_vegetation = (
        before_vegetation
        & after_vegetation
    )

    stable_non_vegetation = (
        common_valid
        & ~before_vegetation
        & ~after_vegetation
    )

    loss_pixels = int(
        np.count_nonzero(vegetation_loss)
    )

    gain_pixels = int(
        np.count_nonzero(vegetation_gain)
    )

    stable_vegetation_pixels = int(
        np.count_nonzero(stable_vegetation)
    )

    stable_non_vegetation_pixels = int(
        np.count_nonzero(stable_non_vegetation)
    )

    before_vegetation_pixels = int(
        np.count_nonzero(before_vegetation)
    )

    after_vegetation_pixels = int(
        np.count_nonzero(after_vegetation)
    )

    net_vegetation_pixels = (
        gain_pixels - loss_pixels
    )

    # ======================================
    # Calculate Geographic Area
    # ======================================

    pixel_area_m2 = calculate_pixel_area(
        before_result["transform"],
        before_result["crs"],
    )

    loss_area = area_statistics(
        loss_pixels,
        pixel_area_m2,
    )

    gain_area = area_statistics(
        gain_pixels,
        pixel_area_m2,
    )

    before_area = area_statistics(
        before_vegetation_pixels,
        pixel_area_m2,
    )

    after_area = area_statistics(
        after_vegetation_pixels,
        pixel_area_m2,
    )

    stable_vegetation_area = area_statistics(
        stable_vegetation_pixels,
        pixel_area_m2,
    )

    stable_non_vegetation_area = area_statistics(
        stable_non_vegetation_pixels,
        pixel_area_m2,
    )

    net_area = area_statistics(
        abs(net_vegetation_pixels),
        pixel_area_m2,
    )

    if net_vegetation_pixels < 0:
        net_area["area_hectares"] *= -1
        net_area["area_sq_km"] *= -1

    net_area["pixels"] = net_vegetation_pixels

    # ======================================
    # Calculate Mean NDVI
    # ======================================

    mean_before = float(
        np.mean(before_values[common_valid])
    )

    mean_after = float(
        np.mean(aligned_after[common_valid])
    )

    mean_difference = (
        mean_after - mean_before
    )

    # ======================================
    # Generate Geographic Overlay
    # ======================================

    # Reuse the existing geographic overlay
    # generator. Values +1 and -1 encode
    # vegetation gain and loss respectively.

    transition_values = np.zeros(
        before_values.shape,
        dtype=np.float32,
    )

    transition_values[vegetation_gain] = 1.0
    transition_values[vegetation_loss] = -1.0

    overlay = build_change_overlay(
        change_values=transition_values,
        valid_mask=common_valid,
        raster_crs=before_result["crs"],
        raster_transform=before_result["transform"],
        threshold=0.5,
    )

    overlay["legend"] = [
        {
            "label": "Potential Vegetation Gain",
            "color": "#22c55e",
        },
        {
            "label": "Potential Vegetation Loss",
            "color": "#ef4444",
        },
        {
            "label": "Stable or Invalid",
            "color": "transparent",
        },
    ]

    # ======================================
    # Satellite Metadata
    # ======================================

    before_scene = before_result["scene"]
    after_scene = after_result["scene"]

    def scene_information(
        scene,
        result,
        selection,
        mean_index,
    ):
        return {
            "scene_id": scene.id,
            "acquisition_date": (
                scene.datetime.isoformat()
                if scene.datetime
                else None
            ),
            "cloud_cover": (
                scene.properties.get(
                    "eo:cloud_cover"
                )
            ),
            "mean_ndvi": round(
                mean_index,
                4,
            ),
            "valid_pixel_percentage": round(
                float(result["valid_percentage"]),
                2,
            ),
            "scenes_evaluated": len(
                selection["candidates"]
            ),
            "scene_candidates": (
                selection["candidates"]
            ),
        }

    print("Before:", before_scene.id)
    print("After:", after_scene.id)

    print("Potential vegetation loss:", loss_pixels)
    print("Potential vegetation gain:", gain_pixels)

    print(
        "=================================================\n"
    )

    # ======================================
    # API Response
    # ======================================

    return {
        "status": "success",
        "analysis": (
            "Potential Vegetation Loss and Gain"
        ),
        "source": "Element 84 Earth Search",
        "satellite": "Sentinel-2 Level-2A",
        "index_type": "NDVI",
        "vegetation_threshold": (
            vegetation_threshold
        ),
        "before": scene_information(
            before_scene,
            before_result,
            before_selection,
            mean_before,
        ),
        "after": scene_information(
            after_scene,
            after_result,
            after_selection,
            mean_after,
        ),
        "statistics": {
            "total_pixels": total_pixels,
            "common_valid_pixels": (
                common_valid_pixels
            ),
            "common_valid_percentage": percentage(
                common_valid_pixels,
                total_pixels,
            ),
            "mean_before_ndvi": round(
                mean_before,
                4,
            ),
            "mean_after_ndvi": round(
                mean_after,
                4,
            ),
            "mean_ndvi_change": round(
                mean_difference,
                4,
            ),
            "potential_loss": {
                **loss_area,
                "percentage": percentage(
                    loss_pixels,
                    common_valid_pixels,
                ),
            },
            "potential_gain": {
                **gain_area,
                "percentage": percentage(
                    gain_pixels,
                    common_valid_pixels,
                ),
            },
            "stable_vegetation": {
                **stable_vegetation_area,
                "percentage": percentage(
                    stable_vegetation_pixels,
                    common_valid_pixels,
                ),
            },
            "stable_non_vegetation": {
                **stable_non_vegetation_area,
                "percentage": percentage(
                    stable_non_vegetation_pixels,
                    common_valid_pixels,
                ),
            },
            "before_vegetation": before_area,
            "after_vegetation": after_area,
            "net_vegetation_change": net_area,
            "pixel_area_sq_m": round(
                pixel_area_m2,
                4,
            ),
        },
        "overlay": overlay,
        "methodology": {
            "classification": (
                "NDVI threshold classification"
            ),
            "vegetation_rule": (
                "NDVI greater than or equal "
                "to vegetation_threshold"
            ),
            "loss_rule": (
                "Vegetation signal before, "
                "non-vegetation signal after"
            ),
            "gain_rule": (
                "Non-vegetation signal before, "
                "vegetation signal after"
            ),
            "comparison": (
                "Common valid pixels on aligned "
                "Sentinel-2 raster grids"
            ),
        },
        "message": (
            "Potential vegetation transitions "
            "were estimated using NDVI threshold "
            "crossings from real Sentinel-2 data. "
            "Area estimates are approximate. "
            "Seasonal differences, atmospheric "
            "effects, mixed pixels, and threshold "
            "selection can affect results. "
            "These results do not independently "
            "confirm land-cover changes."
        ),
    }


# ==========================================
# Local Module Test
# ==========================================

if __name__ == "__main__":
    print(
        "GeoPulse vegetation detection module loaded."
    )

    print(
        "Supported analysis: "
        "Potential vegetation loss and gain"
    )

    print(
        "Default NDVI threshold:",
        DEFAULT_VEGETATION_THRESHOLD,
    )
