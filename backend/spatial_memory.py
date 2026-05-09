import math
import time

try:
    import firebase_admin
    from firebase_admin import firestore as fb_firestore
    FIREBASE_AVAILABLE = True
except ImportError:
    FIREBASE_AVAILABLE = False

_FALLBACK: list[dict] = []


def _get_firestore():
    if not FIREBASE_AVAILABLE:
        return None
    if not firebase_admin._apps:
        return None
    return fb_firestore.client()


class SpatialMemory:
    def __init__(self):
        self.db = _get_firestore()
        self._collection = "locations"

    def remember(self, lat: float, lng: float, description: str) -> dict:
        nearby = self.get_nearby(lat, lng, radius_m=15)

        if self.db:
            if nearby:
                doc_id = nearby[0]["id"]
                self.db.collection(self._collection).document(doc_id).update({
                    "visit_count": fb_firestore.Increment(1),
                    "description": description,
                    "last_visited": int(time.time()),
                })
                return {"updated": True, "id": doc_id}
            else:
                ref = self.db.collection(self._collection).document()
                ref.set({
                    "lat": lat,
                    "lng": lng,
                    "description": description,
                    "visit_count": 1,
                    "created_at": int(time.time()),
                    "last_visited": int(time.time()),
                })
                return {"created": True, "id": ref.id}
        else:
            _FALLBACK.append({"id": str(len(_FALLBACK)), "lat": lat, "lng": lng,
                               "description": description, "visits": 1})
            return {"created": True, "id": str(len(_FALLBACK) - 1)}

    def get_nearby(self, lat: float, lng: float, radius_m: int = 100) -> list[dict]:
        if self.db:
            docs = self.db.collection(self._collection).stream()
            results = []
            for doc in docs:
                data = doc.to_dict()
                dist = _haversine(lat, lng, data["lat"], data["lng"])
                if dist <= radius_m:
                    results.append({
                        "id": doc.id,
                        "lat": data["lat"],
                        "lng": data["lng"],
                        "description": data["description"],
                        "visits": data.get("visit_count", 1),
                        "distance": round(dist),
                    })
            return sorted(results, key=lambda x: x["distance"])
        else:
            return [
                {**loc, "distance": round(_haversine(lat, lng, loc["lat"], loc["lng"]))}
                for loc in _FALLBACK
                if _haversine(lat, lng, loc["lat"], loc["lng"]) <= radius_m
            ]

    def list_all(self) -> list[dict]:
        if self.db:
            docs = self.db.collection(self._collection).order_by(
                "visit_count", direction=fb_firestore.Query.DESCENDING
            ).stream()
            return [{"id": d.id, **d.to_dict()} for d in docs]
        return _FALLBACK


def _haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
