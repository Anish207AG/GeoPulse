
import os
from datetime import date
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from pystac_client import Client

from ndvi import calculate_ndvi
from ndwi import calculate_ndwi
from change_detection import calculate_change_detection
from comparison import calculate_satellite_comparison
from vegetation import calculate_vegetation_change
from water_change import calculate_water_change
from history import calculate_historical_monitoring



# ==========================================
# GeoPulse FastAPI Application
# ==========================================

app = FastAPI(
    title="GeoPulse API",
    description="Satellite-based geospatial monitoring system",
    version="1.4.0",
)


# ==========================================
# CORS Configuration
# ==========================================

LOCAL_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "http://localhost:5175",
    "http://127.0.0.1:5175",
]

FRONTEND_URL = os.getenv("FRONTEND_URL", "").rstrip("/")
ALLOWED_ORIGINS = LOCAL_ORIGINS.copy()

if FRONTEND_URL:
    ALLOWED_ORIGINS.append(FRONTEND_URL)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==========================================
# Home Endpoint
# ==========================================

@app.get("/")
def home():
    return {
        "project": "GeoPulse",
        "status": "Running",
        "study_area": "Chennai, Tamil Nadu",
        "message": "Welcome to GeoPulse API",
    }


# ==========================================
# Health Check
# ==========================================

@app.get("/api/health")
def health():
    return {
        "status": "healthy",
        "backend": "connected",
    }


# ==========================================
# Study Area Model
# ==========================================

class StudyArea(BaseModel):
    north: float = Field(ge=-90, le=90)
    south: float = Field(ge=-90, le=90)
    east: float = Field(ge=-180, le=180)
    west: float = Field(ge=-180, le=180)


def validate_area(area):
    if area.north <= area.south:
        raise HTTPException(
            status_code=422,
            detail="North must be greater than South",
        )

    if area.east <= area.west:
        raise HTTPException(
            status_code=422,
            detail="East must be greater than West",
        )


# ==========================================
# Submit Study Area
# ==========================================

@app.post("/api/study-area")
def receive_study_area(area: StudyArea):
    validate_area(area)

    return {
        "status": "success",
        "message": "Study area received successfully",
        "coordinates": area.model_dump(),
        "next_step": "Satellite imagery analysis",
    }


# ==========================================
# Satellite Search Model
# ==========================================

class SatelliteSearch(StudyArea):
    start_date: date
    end_date: date
    max_cloud_cover: float = Field(
        default=30,
        ge=0,
        le=100,
    )


def validate_satellite_request(request):
    validate_area(request)

    if request.start_date > request.end_date:
        raise HTTPException(
            status_code=422,
            detail="Start date must be before end date",
        )


# ==========================================
# Search Real Sentinel-2 Images
# ==========================================

@app.post("/api/satellite/search")
def search_satellite_images(request: SatelliteSearch):
    validate_satellite_request(request)

    bbox = [
        request.west,
        request.south,
        request.east,
        request.north,
    ]

    try:
        catalog = Client.open(
            "https://earth-search.aws.element84.com/v1"
        )

        search = catalog.search(
            collections=["sentinel-2-l2a"],
            bbox=bbox,
            datetime=(
                f"{request.start_date.isoformat()}/"
                f"{request.end_date.isoformat()}"
            ),
            query={
                "eo:cloud_cover": {
                    "lte": request.max_cloud_cover
                }
            },
            max_items=10,
        )

        items = list(search.items())

        images = [
            {
                "id": item.id,
                "date": (
                    item.datetime.isoformat()
                    if item.datetime
                    else None
                ),
                "cloud_cover": item.properties.get(
                    "eo:cloud_cover"
                ),
                "collection": item.collection_id,
                "thumbnail": (
                    item.assets["thumbnail"].href
                    if "thumbnail" in item.assets
                    else None
                ),
            }
            for item in items
        ]

        return {
            "status": "success",
            "source": "Element 84 Earth Search",
            "satellite": "Sentinel-2 Level-2A",
            "total_results": len(images),
            "images": images,
        }

    except Exception as error:
        print("Satellite search error:", error)

        raise HTTPException(
            status_code=502,
            detail=(
                "Satellite catalog unavailable "
                "or search failed"
            ),
        )


# ==========================================
# Real NDVI Vegetation Analysis
# ==========================================

@app.post("/api/satellite/ndvi")
def analyze_satellite_ndvi(request: SatelliteSearch):
    validate_satellite_request(request)

    bbox = [
        request.west,
        request.south,
        request.east,
        request.north,
    ]

    try:
        return calculate_ndvi(
            bbox=bbox,
            start_date=request.start_date.isoformat(),
            end_date=request.end_date.isoformat(),
            max_cloud_cover=request.max_cloud_cover,
        )

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        )

    except Exception as error:
        print("NDVI processing error:", error)

        raise HTTPException(
            status_code=502,
            detail="Satellite NDVI processing failed",
        )


# ==========================================
# Real NDWI Water Detection
# ==========================================

@app.post("/api/satellite/ndwi")
def analyze_satellite_ndwi(request: SatelliteSearch):
    validate_satellite_request(request)

    bbox = [
        request.west,
        request.south,
        request.east,
        request.north,
    ]

    try:
        return calculate_ndwi(
            bbox=bbox,
            start_date=request.start_date.isoformat(),
            end_date=request.end_date.isoformat(),
            max_cloud_cover=request.max_cloud_cover,
        )

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        )

    except Exception as error:
        print("NDWI processing error:", error)

        raise HTTPException(
            status_code=502,
            detail="Satellite NDWI processing failed",
        )


# ==========================================
# Step 21: Change Detection Request Model
# ==========================================

class ChangeDetectionRequest(StudyArea):
    before_start_date: date
    before_end_date: date
    after_start_date: date
    after_end_date: date

    index_type: Literal["NDVI", "NDWI"] = "NDVI"

    max_cloud_cover: float = Field(
        default=30,
        ge=0,
        le=100,
    )

    change_threshold: float = Field(
        default=0.15,
        gt=0,
        le=2,
    )


def validate_change_request(request):
    validate_area(request)

    if request.before_start_date > request.before_end_date:
        raise HTTPException(
            status_code=422,
            detail=(
                "Before start date must be "
                "on or before before end date."
            ),
        )

    if request.after_start_date > request.after_end_date:
        raise HTTPException(
            status_code=422,
            detail=(
                "After start date must be "
                "on or before after end date."
            ),
        )

    if request.before_end_date >= request.after_start_date:
        raise HTTPException(
            status_code=422,
            detail=(
                "The before period must end "
                "before the after period begins."
            ),
        )


# ==========================================
# Step 21: Real Satellite Change Detection
# ==========================================

@app.post("/api/satellite/change-detection")
def analyze_satellite_change(
    request: ChangeDetectionRequest,
):
    validate_change_request(request)

    bbox = [
        request.west,
        request.south,
        request.east,
        request.north,
    ]

    try:
        return calculate_change_detection(
            bbox=bbox,
            before_start_date=(
                request.before_start_date.isoformat()
            ),
            before_end_date=(
                request.before_end_date.isoformat()
            ),
            after_start_date=(
                request.after_start_date.isoformat()
            ),
            after_end_date=(
                request.after_end_date.isoformat()
            ),
            index_type=request.index_type,
            max_cloud_cover=request.max_cloud_cover,
            change_threshold=request.change_threshold,
        )

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        )

    except Exception as error:
        print("Satellite change detection error:", error)

        raise HTTPException(
            status_code=502,
            detail=(
                "Satellite change detection "
                "processing failed."
            ),
        )


# ==========================================
# Step 22: Comparison Request Model
# ==========================================

class SatelliteComparisonRequest(StudyArea):
    before_start_date: date
    before_end_date: date
    after_start_date: date
    after_end_date: date

    index_type: Literal["NDVI", "NDWI"] = "NDVI"

    max_cloud_cover: float = Field(
        default=30,
        ge=0,
        le=100,
    )


def validate_comparison_request(request):
    validate_area(request)

    if request.before_start_date > request.before_end_date:
        raise HTTPException(
            status_code=422,
            detail="Invalid before date range.",
        )

    if request.after_start_date > request.after_end_date:
        raise HTTPException(
            status_code=422,
            detail="Invalid after date range.",
        )

    if request.before_end_date >= request.after_start_date:
        raise HTTPException(
            status_code=422,
            detail=(
                "Before period must end "
                "before after period begins."
            ),
        )


# ==========================================
# Step 22: Before-and-After Satellite Comparison
# ==========================================

@app.post("/api/satellite/comparison")
def analyze_satellite_comparison(
    request: SatelliteComparisonRequest,
):
    validate_comparison_request(request)

    bbox = [
        request.west,
        request.south,
        request.east,
        request.north,
    ]

    try:
        return calculate_satellite_comparison(
            bbox=bbox,
            before_start_date=(
                request.before_start_date.isoformat()
            ),
            before_end_date=(
                request.before_end_date.isoformat()
            ),
            after_start_date=(
                request.after_start_date.isoformat()
            ),
            after_end_date=(
                request.after_end_date.isoformat()
            ),
            index_type=request.index_type,
            max_cloud_cover=request.max_cloud_cover,
        )

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        )

    except Exception as error:
        print(
            "Satellite comparison processing error:",
            error,
        )

        raise HTTPException(
            status_code=502,
            detail=(
                "Satellite comparison "
                "processing failed."
            ),
        )


# ==========================================
# Step 23: Vegetation Request Model
# ==========================================

class VegetationChangeRequest(StudyArea):
    before_start_date: date
    before_end_date: date
    after_start_date: date
    after_end_date: date

    max_cloud_cover: float = Field(
        default=30,
        ge=0,
        le=100,
    )

    vegetation_threshold: float = Field(
        default=0.3,
        ge=-1,
        le=1,
    )


def validate_vegetation_request(request):
    validate_area(request)

    if request.before_start_date > request.before_end_date:
        raise HTTPException(
            status_code=422,
            detail="Invalid before date range.",
        )

    if request.after_start_date > request.after_end_date:
        raise HTTPException(
            status_code=422,
            detail="Invalid after date range.",
        )

    if request.before_end_date >= request.after_start_date:
        raise HTTPException(
            status_code=422,
            detail=(
                "Before period must end before "
                "the after period begins."
            ),
        )


# ==========================================
# Step 23: Vegetation Loss and Gain Detection
# ==========================================

@app.post("/api/satellite/vegetation-change")
def analyze_vegetation_change(
    request: VegetationChangeRequest,
):
    validate_vegetation_request(request)

    bbox = [
        request.west,
        request.south,
        request.east,
        request.north,
    ]

    try:
        return calculate_vegetation_change(
            bbox=bbox,
            before_start_date=(
                request.before_start_date.isoformat()
            ),
            before_end_date=(
                request.before_end_date.isoformat()
            ),
            after_start_date=(
                request.after_start_date.isoformat()
            ),
            after_end_date=(
                request.after_end_date.isoformat()
            ),
            max_cloud_cover=request.max_cloud_cover,
            vegetation_threshold=(
                request.vegetation_threshold
            ),
        )

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        )

    except Exception as error:
        print(
            "Vegetation change processing error:",
            error,
        )

        raise HTTPException(
            status_code=502,
            detail=(
                "Vegetation change processing failed."
            ),
        )


# ==========================================
# Step 24: Water Change Request Model
# ==========================================

class WaterChangeRequest(StudyArea):
    before_start_date: date
    before_end_date: date
    after_start_date: date
    after_end_date: date

    max_cloud_cover: float = Field(
        default=30,
        ge=0,
        le=100,
    )

    water_threshold: float = Field(
        default=0.0,
        ge=-1,
        le=1,
    )


# ==========================================
# Step 24: Water Loss and Gain Detection
# ==========================================

@app.post("/api/satellite/water-change")
def analyze_water_change(request: WaterChangeRequest):
    validate_vegetation_request(request)

    bbox = [
        request.west,
        request.south,
        request.east,
        request.north,
    ]

    try:
        return calculate_water_change(
            bbox=bbox,
            before_start_date=(
                request.before_start_date.isoformat()
            ),
            before_end_date=(
                request.before_end_date.isoformat()
            ),
            after_start_date=(
                request.after_start_date.isoformat()
            ),
            after_end_date=(
                request.after_end_date.isoformat()
            ),
            max_cloud_cover=request.max_cloud_cover,
            water_threshold=request.water_threshold,
        )

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        )

    except Exception as error:
        print("Water change processing error:", error)

        raise HTTPException(
            status_code=502,
            detail="Water change processing failed.",
        )


# ==========================================
# Step 28: Historical Monitoring Request
# ==========================================

class HistoricalMonitoringRequest(StudyArea):
    start_date: date
    end_date: date

    max_cloud_cover: float = Field(
        default=30,
        ge=0,
        le=100,
    )

    max_observations: int = Field(
        default=6,
        ge=2,
        le=6,
    )


# ==========================================
# Step 28: Historical Satellite Monitoring
# ==========================================

@app.post("/api/satellite/history")
def analyze_satellite_history(
    request: HistoricalMonitoringRequest,
):
    validate_area(request)

    if request.start_date > request.end_date:
        raise HTTPException(
            status_code=422,
            detail="Start date must be before end date.",
        )

    bbox = [
        request.west,
        request.south,
        request.east,
        request.north,
    ]

    try:
        return calculate_historical_monitoring(
            bbox=bbox,
            start_date=request.start_date.isoformat(),
            end_date=request.end_date.isoformat(),
            max_cloud_cover=request.max_cloud_cover,
            max_observations=request.max_observations,
        )

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        )

    except Exception as error:
        print("Historical monitoring error:", error)

        raise HTTPException(
            status_code=502,
            detail="Historical satellite processing failed.",
        )
