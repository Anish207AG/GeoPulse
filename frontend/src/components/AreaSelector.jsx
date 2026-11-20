
import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

import "leaflet-draw";
import "leaflet-draw/dist/leaflet.draw.css";

function AreaSelector({ onAreaSelect }) {
  const map = useMap();
  const callbackRef = useRef(onAreaSelect);

  useEffect(() => {
    callbackRef.current = onAreaSelect;
  }, [onAreaSelect]);

  useEffect(() => {
    const drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);

    const drawControl = new L.Control.Draw({
      position: "topleft",

      draw: {
        polyline: false,
        polygon: false,
        circle: false,
        circlemarker: false,
        marker: false,
        rectangle: {
          shapeOptions: {
            color: "#38bdf8",
            weight: 3,
          },
        },
      },

      edit: {
        featureGroup: drawnItems,
        edit: false,
        remove: true,
      },
    });

    map.addControl(drawControl);

    function handleCreated(event) {
      drawnItems.clearLayers();
      drawnItems.addLayer(event.layer);

      const bounds = event.layer.getBounds();

      callbackRef.current({
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest(),
      });
    }

    function handleDeleted() {
      callbackRef.current(null);
    }

    map.on(L.Draw.Event.CREATED, handleCreated);
    map.on(L.Draw.Event.DELETED, handleDeleted);

    return () => {
      map.off(L.Draw.Event.CREATED, handleCreated);
      map.off(L.Draw.Event.DELETED, handleDeleted);
      map.removeControl(drawControl);
      map.removeLayer(drawnItems);
    };
  }, [map]);

  return null;
}

export default AreaSelector;
