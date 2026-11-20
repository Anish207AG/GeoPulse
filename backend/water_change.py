
"""
GeoPulse - Step 24
Potential Water Loss and Gain Detection

Uses real Sentinel-2 Level-2A NDWI observations.

NDWI > threshold: possible water
NDWI <= threshold: non-water

Results are spectral classifications, not verified
flooding or permanent water-body changes.
"""

import numpy as np

from change_detection import (
    select_best_scene,
    prepare_index_array,
    align_raster,
    build_change_overlay,
)

from vegetation import (
    calculate_pixel_area,
    percentage,
    area_statistics,
)


DEFAULT_WATER_THRESHOLD = 0.0
MAX_WATER_PIXELS = 4_000_000


def validate_water_inputs(
    bbox,
    before_start_date,
    before_end_date,
    after_start_date,
    after_end_date,
    water_threshold,
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
        raise ValueError("Invalid before date range.")

    if after_start_date > after_end_date:
        raise ValueError("Invalid after date range.")

    if before_end_date >= after_start_date:
        raise ValueError(
            "Before period must end before after period."
        )

    if (
        not np.isfinite(water_threshold)
        or not -1 <= water_threshold <= 1
    ):
        raise ValueError(
            "Water threshold must be between -1 and 1."
        )

    if (
        not np.isfinite(max_cloud_cover)
        or not 0 <= max_cloud_cover <= 100
    ):
        raise ValueError(
            "Cloud cover must be between 0 and 100."
        )


def calculate_water_change(
    bbox,
    before_start_date,
    before_end_date,
    after_start_date,
    after_end_date,
    max_cloud_cover=30,
    water_threshold=DEFAULT_WATER_THRESHOLD,
):
    validate_water_inputs(
        bbox,
        before_start_date,
        before_end_date,
        after_start_date,
        after_end_date,
        water_threshold,
        max_cloud_cover,
    )

    print("\n========== GeoPulse Water Detection ==========")

    before_selection = select_best_scene(
        bbox=bbox,
        start_date=before_start_date,
        end_date=before_end_date,
        max_cloud_cover=max_cloud_cover,
        index_type="NDWI",
    )

    after_selection = select_best_scene(
        bbox=bbox,
        start_date=after_start_date,
        end_date=after_end_date,
        max_cloud_cover=max_cloud_cover,
        index_type="NDWI",
    )

    before_result = before_selection["result"]
    after_result = after_selection["result"]

    before_values, before_valid = prepare_index_array(
        before_result["ndwi"]
    )

    after_values, after_valid = prepare_index_array(
        after_result["ndwi"]
    )

    if before_values.size > MAX_WATER_PIXELS:
        raise ValueError(
            "Study area is too large for water analysis. "
            "Select a smaller rectangle."
        )

    aligned_after, aligned_after_valid = align_raster(
        source_values=after_values,
        source_valid=after_valid,
        source_crs=after_result["crs"],
        source_transform=after_result["transform"],
        target_crs=before_result["crs"],
        target_transform=before_result["transform"],
        target_shape=before_values.shape,
    )

    common_valid = before_valid & aligned_after_valid

    total_pixels = int(common_valid.size)
    common_valid_pixels = int(np.count_nonzero(common_valid))

    if common_valid_pixels == 0:
        raise ValueError(
            "No overlapping valid pixels were found."
        )

    before_water = (
        common_valid
        & (before_values > water_threshold)
    )

    after_water = (
        common_valid
        & (aligned_after > water_threshold)
    )

    water_loss = before_water & ~after_water

    water_gain = (
        ~before_water
        & after_water
        & common_valid
    )

    stable_water = before_water & after_water

    stable_non_water = (
        common_valid
        & ~before_water
        & ~after_water
    )

    loss_pixels = int(np.count_nonzero(water_loss))
    gain_pixels = int(np.count_nonzero(water_gain))

    stable_water_pixels = int(
        np.count_nonzero(stable_water)
    )

    stable_non_water_pixels = int(
        np.count_nonzero(stable_non_water)
    )

    before_water_pixels = int(
        np.count_nonzero(before_water)
    )

    after_water_pixels = int(
        np.count_nonzero(after_water)
    )

    net_water_pixels = gain_pixels - loss_pixels

    pixel_area_m2 = calculate_pixel_area(
        before_result["transform"],
        before_result["crs"],
    )

    def classified_area(pixel_count):
        return {
            **area_statistics(pixel_count, pixel_area_m2),
            "percentage": percentage(
                pixel_count,
                common_valid_pixels,
            ),
        }

    net_area = area_statistics(
        abs(net_water_pixels),
        pixel_area_m2,
    )

    if net_water_pixels < 0:
        net_area["area_hectares"] *= -1
        net_area["area_sq_km"] *= -1

    net_area["pixels"] = net_water_pixels

    mean_before = float(
        np.mean(before_values[common_valid])
    )

    mean_after = float(
        np.mean(aligned_after[common_valid])
    )

    transition_values = np.zeros(
        before_values.shape,
        dtype=np.float32,
    )

    transition_values[water_gain] = 1.0
    transition_values[water_loss] = -1.0

    overlay = build_change_overlay(
        change_values=transition_values,
        valid_mask=common_valid,
        raster_crs=before_result["crs"],
        raster_transform=before_result["transform"],
        threshold=0.5,
    )

    overlay["legend"] = [
        {
            "label": "Potential Water Gain",
            "color": "#22c55e",
        },
        {
            "label": "Potential Water Loss",
            "color": "#ef4444",
        },
        {
            "label": "Stable or Invalid",
            "color": "transparent",
        },
    ]

    def scene_information(selection, mean_index):
        result = selection["result"]
        scene = result["scene"]

        return {
            "scene_id": scene.id,
            "acquisition_date": (
                scene.datetime.isoformat()
                if scene.datetime
                else None
            ),
            "cloud_cover": scene.properties.get(
                "eo:cloud_cover"
            ),
            "mean_ndwi": round(mean_index, 4),
            "valid_pixel_percentage": round(
                float(result["valid_percentage"]),
                2,
            ),
            "scenes_evaluated": len(
                selection["candidates"]
            ),
            "scene_candidates": selection["candidates"],
        }

    print(
        "Potential water loss:",
        loss_pixels,
        "Potential water gain:",
        gain_pixels,
    )

    return {
        "status": "success",
        "analysis": "Potential Water Loss and Gain",
        "source": "Element 84 Earth Search",
        "satellite": "Sentinel-2 Level-2A",
        "index_type": "NDWI",
        "water_threshold": water_threshold,
        "before": scene_information(
            before_selection,
            mean_before,
        ),
        "after": scene_information(
            after_selection,
            mean_after,
        ),
        "statistics": {
            "total_pixels": total_pixels,
            "common_valid_pixels": common_valid_pixels,
            "common_valid_percentage": percentage(
                common_valid_pixels,
                total_pixels,
            ),
            "mean_before_ndwi": round(mean_before, 4),
            "mean_after_ndwi": round(mean_after, 4),
            "mean_ndwi_change": round(
                mean_after - mean_before,
                4,
            ),
            "potential_loss": classified_area(
                loss_pixels
            ),
            "potential_gain": classified_area(
                gain_pixels
            ),
            "stable_water": classified_area(
                stable_water_pixels
            ),
            "stable_non_water": classified_area(
                stable_non_water_pixels
            ),
            "before_water": area_statistics(
                before_water_pixels,
                pixel_area_m2,
            ),
            "after_water": area_statistics(
                after_water_pixels,
                pixel_area_m2,
            ),
            "net_water_change": net_area,
            "pixel_area_sq_m": round(
                pixel_area_m2,
                4,
            ),
        },
        "overlay": overlay,
        "methodology": {
            "classification": (
                "NDWI threshold-based possible-water "
                "classification"
            ),
            "water_rule": "NDWI > water_threshold",
            "loss_rule": (
                "Possible water before, non-water after"
            ),
            "gain_rule": (
                "Non-water before, possible water after"
            ),
            "comparison": (
                "Common valid pixels on aligned "
                "Sentinel-2 raster grids"
            ),
        },
        "message": (
            "Potential water transitions estimated "
            "using NDWI threshold crossings. "
            "Area estimates are approximate. "
            "Seasonal variation, clouds, shadows, "
            "mixed pixels and threshold selection "
            "may affect results. These results do "
            "not independently confirm flooding or "
            "permanent water-body change."
        ),
    }


if __name__ == "__main__":
    print("GeoPulse water detection module loaded.")
