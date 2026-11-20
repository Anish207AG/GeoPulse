
from datetime import date
from collections import defaultdict

import numpy as np
from pystac_client import Client

from ndvi import process_scene as process_ndvi_scene
from ndwi import process_scene as process_ndwi_scene


CATALOG_URL = "https://earth-search.aws.element84.com/v1"
COLLECTION = "sentinel-2-l2a"

MAX_OBSERVATIONS = 6
MAX_CATALOG_ITEMS = 100
MIN_VALID_COVERAGE = 50.0


def scene_date(scene):
    if scene.datetime is None:
        return None
    return scene.datetime.date().isoformat()


def scene_cloud_cover(scene):
    value = scene.properties.get("eo:cloud_cover")
    return float(value) if value is not None else None


def cloud_sort_key(scene):
    cloud = scene_cloud_cover(scene)
    return cloud if cloud is not None else 101.0


def choose_historical_scenes(scenes, limit):
    """
    Choose observations from different months where possible.

    This produces a sampled historical series, not a
    complete inventory of every Sentinel-2 acquisition.
    """
    groups = defaultdict(list)

    for scene in scenes:
        day = scene_date(scene)

        if day:
            groups[day[:7]].append(scene)

    if not groups:
        return []

    months = sorted(groups.keys())

    for month in months:
        groups[month].sort(key=cloud_sort_key)

    if len(months) <= limit:
        selected_months = months
    elif limit == 1:
        selected_months = [months[-1]]
    else:
        positions = [
            round(i * (len(months) - 1) / (limit - 1))
            for i in range(limit)
        ]
        selected_months = [months[i] for i in positions]

    # Retain up to three candidates per selected month
    # so failed or cloudy scenes can be replaced.
    selected = []

    for month in selected_months:
        selected.extend(groups[month][:3])

    return selected


def calculate_historical_monitoring(
    bbox,
    start_date,
    end_date,
    max_cloud_cover=30,
    max_observations=6,
):
    if not 2 <= max_observations <= MAX_OBSERVATIONS:
        raise ValueError(
            "max_observations must be between 2 and 6."
        )

    if date.fromisoformat(start_date) > date.fromisoformat(end_date):
        raise ValueError("Invalid historical date range.")

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
        max_items=MAX_CATALOG_ITEMS,
    )

    scenes = list(search.items())

    if not scenes:
        raise ValueError(
            "No Sentinel-2 observations found. "
            "Try another date range or cloud-cover limit."
        )

    candidates = choose_historical_scenes(
        scenes,
        max_observations,
    )

    observations = []
    failures = []
    used_months = set()

    for scene in candidates:
        if len(observations) >= max_observations:
            break

        day = scene_date(scene)

        if not day:
            continue

        month = day[:7]

        if month in used_months:
            continue

        try:
            ndvi_result = process_ndvi_scene(scene, bbox)
            ndwi_result = process_ndwi_scene(scene, bbox)

            ndvi_values = ndvi_result["ndvi"].compressed()
            ndwi_values = ndwi_result["ndwi"].compressed()

            if ndvi_values.size == 0 or ndwi_values.size == 0:
                raise ValueError("No usable index pixels.")

            ndvi_coverage = ndvi_result["valid_percentage"]
            ndwi_coverage = ndwi_result["valid_percentage"]

            if min(ndvi_coverage, ndwi_coverage) < MIN_VALID_COVERAGE:
                raise ValueError(
                    "Valid coverage below 50%."
                )

            observations.append({
                "date": day,
                "scene_id": scene.id,
                "cloud_cover": scene_cloud_cover(scene),
                "mean_ndvi": round(
                    float(np.mean(ndvi_values)), 4
                ),
                "min_ndvi": round(
                    float(np.min(ndvi_values)), 4
                ),
                "max_ndvi": round(
                    float(np.max(ndvi_values)), 4
                ),
                "mean_ndwi": round(
                    float(np.mean(ndwi_values)), 4
                ),
                "min_ndwi": round(
                    float(np.min(ndwi_values)), 4
                ),
                "max_ndwi": round(
                    float(np.max(ndwi_values)), 4
                ),
                "ndvi_valid_coverage": round(
                    ndvi_coverage, 2
                ),
                "ndwi_valid_coverage": round(
                    ndwi_coverage, 2
                ),
                "ndvi_valid_pixels": ndvi_result["valid_pixels"],
                "ndwi_valid_pixels": ndwi_result["valid_pixels"],
            })

            used_months.add(month)

        except Exception as error:
            print(
                f"Historical scene {scene.id} failed: {error}"
            )
            failures.append({
                "scene_id": scene.id,
                "reason": str(error),
            })

    observations.sort(key=lambda item: item["date"])

    if not observations:
        raise ValueError(
            "No usable historical observations were processed. "
            "Try a smaller area or different dates."
        )

    first = observations[0]
    last = observations[-1]

    summary = {
        "first_date": first["date"],
        "last_date": last["date"],
        "observation_count": len(observations),
        "first_mean_ndvi": first["mean_ndvi"],
        "last_mean_ndvi": last["mean_ndvi"],
        "ndvi_change": round(
            last["mean_ndvi"] - first["mean_ndvi"], 4
        ),
        "first_mean_ndwi": first["mean_ndwi"],
        "last_mean_ndwi": last["mean_ndwi"],
        "ndwi_change": round(
            last["mean_ndwi"] - first["mean_ndwi"], 4
        ),
        "minimum_mean_ndvi": min(
            item["mean_ndvi"] for item in observations
        ),
        "maximum_mean_ndvi": max(
            item["mean_ndvi"] for item in observations
        ),
        "minimum_mean_ndwi": min(
            item["mean_ndwi"] for item in observations
        ),
        "maximum_mean_ndwi": max(
            item["mean_ndwi"] for item in observations
        ),
    }

    return {
        "status": "success",
        "analysis": "Historical Satellite Monitoring",
        "source": "Element 84 Earth Search",
        "satellite": "Sentinel-2 Level-2A",
        "study_area": {
            "west": bbox[0],
            "south": bbox[1],
            "east": bbox[2],
            "north": bbox[3],
        },
        "requested_period": {
            "start_date": start_date,
            "end_date": end_date,
        },
        "max_cloud_cover": max_cloud_cover,
        "minimum_valid_coverage": MIN_VALID_COVERAGE,
        "catalog_items_retrieved": len(scenes),
        "catalog_limit": MAX_CATALOG_ITEMS,
        "observations": observations,
        "summary": summary,
        "failed_scenes": failures,
        "limitations": [
            "Observations are sampled from the catalog results.",
            "The catalog query is limited to 100 returned items.",
            "At most one usable observation is selected per sampled month.",
            "Observation dates may be irregular.",
            "NDVI and NDWI means use their respective valid-pixel masks.",
            "Clouds, shadows, seasons and atmospheric conditions "
            "can influence the measured indices.",
            "Index changes do not independently prove vegetation "
            "loss, flooding or other land-cover transitions.",
        ],
    }
