"""
Apple Music API Service - MusicKit Integration
Provides JWT authentication and API access to Apple Music catalog.
"""

import json
import os
import jwt
import time
import httpx
import threading
from pathlib import Path
from typing import Optional, Dict, List, Tuple
from importlib import resources
from .logging_config import get_logger

logger = get_logger(__name__)

BUILTIN_KEY_FILENAME = "apple_music_key.p8"
BUILTIN_KEY_CONFIG = "apple_music_key.json"


class AppleMusicService:
    """Apple Music API service with JWT authentication and caching."""

    # API endpoints
    BASE_URL = "https://api.music.apple.com/v1"

    def __init__(
        self,
        team_id: Optional[str] = None,
        key_id: Optional[str] = None,
        private_key_path: Optional[str] = None,
        storefront: str = "us",
        proxy_base_url: Optional[str] = None,
        proxy_api_key: Optional[str] = None,
    ):
        """
        Initialize Apple Music API service.

        Args:
            team_id: Apple Developer Team ID (10-character alphanumeric)
            key_id: MusicKit API Key ID (10-character alphanumeric)
            private_key_path: Path to .p8 private key file
            storefront: Regional storefront code (default: 'us')
        """
        self.proxy_base_url = (proxy_base_url or "").strip().rstrip("/")
        self.proxy_api_key = (proxy_api_key or "").strip()
        self.storefront = storefront

        builtin_resource = None
        if not self.proxy_base_url and not team_id and not key_id and not private_key_path:
            env_config = self._get_env_builtin_config()
            if env_config["team_id"] and env_config["key_id"] and env_config["key_path"]:
                team_id = env_config["team_id"]
                key_id = env_config["key_id"]
                private_key_path = env_config["key_path"]
                logger.debug("[AM API] Using built-in key from environment")
            else:
                builtin_resource = self._get_resource_builtin_config()
                if builtin_resource:
                    team_id = builtin_resource["team_id"]
                    key_id = builtin_resource["key_id"]
                    logger.debug("[AM API] Using built-in key from packaged resources")

        self.team_id = team_id
        self.key_id = key_id
        self.private_key_path = Path(private_key_path) if private_key_path else None

        # Token cache
        self._cached_token: Optional[str] = None
        self._token_expiry: float = 0
        self._token_lock = threading.Lock()

        # HTTP client
        self._client: Optional[httpx.AsyncClient] = None

        # Loaded private key material for direct Apple API mode
        self._private_key: Optional[str] = None

        if self.proxy_base_url:
            logger.info(f"[AM API] Using proxy mode: {self.proxy_base_url}")
            return

        # Load private key from file or resources (required for API access)
        if self.private_key_path:
            self._load_private_key_from_file()
        elif builtin_resource:
            self._load_private_key_from_resource(builtin_resource)
        else:
            logger.debug("[AM API] No private key configured - API features require credentials")

    @staticmethod
    def _get_env_builtin_config() -> Dict[str, Optional[str]]:
        return {
            "team_id": os.getenv("APPLE_MUSIC_TEAM_ID"),
            "key_id": os.getenv("APPLE_MUSIC_KEY_ID"),
            "key_path": os.getenv("APPLE_MUSIC_P8_PATH"),
        }

    @classmethod
    def _get_resource_builtin_config(cls) -> Optional[Dict[str, str]]:
        try:
            package_root = resources.files("apple_music_history_converter")
            resources_dir = package_root / "resources"
            config_ref = resources_dir / BUILTIN_KEY_CONFIG
            key_ref = resources_dir / BUILTIN_KEY_FILENAME

            if not config_ref.is_file() or not key_ref.is_file():
                return None

            with resources.as_file(config_ref) as config_path:
                with open(config_path, "r", encoding="utf-8") as handle:
                    config = json.load(handle)

            team_id = config.get("team_id")
            key_id = config.get("key_id")
            if not team_id or not key_id:
                return None

            with resources.as_file(key_ref) as key_path:
                private_key = Path(key_path).read_text(encoding="utf-8")

            return {
                "team_id": team_id,
                "key_id": key_id,
                "private_key": private_key,
            }
        except Exception as e:
            logger.error(f"[AM API] Failed to load built-in resource key: {e}")
            return None

    @classmethod
    def has_builtin_credentials(cls) -> bool:
        env_config = cls._get_env_builtin_config()
        if env_config["team_id"] and env_config["key_id"] and env_config["key_path"]:
            return Path(env_config["key_path"]).exists()

        resource_config = cls._get_resource_builtin_config()
        if resource_config:
            return True

        return False

    def _load_private_key_from_file(self):
        """Load and validate private key from file."""
        try:
            if not self.private_key_path:
                return

            # Support both absolute and relative paths
            key_path = self.private_key_path
            if not key_path.is_absolute():
                # Check if key exists in current directory
                current_dir = Path(__file__).parent
                local_key = current_dir / key_path.name
                if local_key.exists():
                    key_path = local_key
                    logger.debug(f"[AM API] Using local key file: {local_key}")

            if not key_path.exists():
                raise FileNotFoundError(f"Private key file not found: {key_path}")

            # Read private key file
            with open(key_path, 'r', encoding='utf-8') as f:
                self._private_key = f.read()

            # Validate key format (should be PEM formatted)
            if "-----BEGIN PRIVATE KEY-----" not in self._private_key:
                raise ValueError("Invalid private key format. Must be PEM formatted .p8 file.")

            logger.debug(f"[AM API] Private key loaded from: {key_path}")
        except Exception as e:
            logger.error(f"[AM API] Failed to load private key: {e}")
            raise

    def _load_private_key_from_resource(self, resource_config: Dict[str, str]):
        """Load private key from bundled resources."""
        private_key = resource_config.get("private_key")
        if not private_key:
            raise ValueError("Built-in private key missing")

        if "-----BEGIN PRIVATE KEY-----" not in private_key:
            raise ValueError("Invalid built-in private key format. Must be PEM formatted .p8 file.")

        self._private_key = private_key

    def _generate_token(self) -> str:
        """
        Generate JWT developer token for MusicKit API.

        Returns:
            JWT token string
        """
        if not self._private_key:
            raise ValueError("Private key not loaded")

        # JWT headers
        headers = {
            'alg': 'ES256',
            'kid': self.key_id
        }

        # JWT payload (180-day max token lifetime)
        now = int(time.time())
        payload = {
            'iss': self.team_id,
            'iat': now,
            'exp': now + (180 * 24 * 60 * 60)  # 180 days
        }

        # Generate token with ES256 signing
        token = jwt.encode(payload, self._private_key, algorithm='ES256', headers=headers)
        return token

    def get_token(self, force_refresh: bool = False) -> str:
        """
        Get valid JWT token, generating new one if expired or force_refresh=True.

        Args:
            force_refresh: Force token regeneration even if not expired

        Returns:
            Valid JWT token string
        """
        with self._token_lock:
            now = time.time()

            # Check if token is valid and not near expiry (add 24h buffer)
            if not force_refresh and self._cached_token and (now < (self._token_expiry - 86400)):
                logger.debug(f"[AM API] Using cached token (expires in {int(self._token_expiry - now)}s)")
                return self._cached_token

            # Generate new token
            logger.debug(f"[AM API] Generating new developer token...")
            self._cached_token = self._generate_token()
            self._token_expiry = time.time() + (180 * 24 * 60 * 60)

            logger.info(f"[AM API] New token generated (expires: {180} days)")
            return self._cached_token

    async def _make_request(self, method: str, path: str, params: Optional[Dict] = None) -> Dict:
        """
        Make authenticated API request to Apple Music API.

        Args:
            method: HTTP method (GET, POST, etc.)
            path: API path (e.g., '/catalog/us/search')
            params: Query parameters

        Returns:
            JSON response as dictionary

        Raises:
            httpx.HTTPError: On network errors
            ValueError: On invalid responses or auth failures
        """
        # Ensure HTTP client exists
        if not self._client:
            self._client = httpx.AsyncClient(timeout=30.0)

        # Get valid token
        token = self.get_token()

        # Construct full URL
        url = f"{self.BASE_URL}{path}"

        # Make request
        try:
            response = await self._client.request(
                method=method,
                url=url,
                headers={'Authorization': f'Bearer {token}'},
                params=params
            )

            # Handle 401 (token expired)
            if response.status_code == 401:
                logger.warning(f"[AM API] Token expired (401), refreshing...")
                self.get_token(force_refresh=True)
                token = self.get_token()
                response = await self._client.request(
                    method=method,
                    url=url,
                    headers={'Authorization': f'Bearer {token}'},
                    params=params
                )

            # Check response status
            response.raise_for_status()

            return response.json()

        except httpx.HTTPStatusError as e:
            logger.error(f"[AM API] HTTP {e.response.status_code}: {e.response.text}")
            raise
        except Exception as e:
            logger.error(f"[AM API] Request failed: {e}")
            raise

    async def _proxy_request(self, path: str, params: Optional[Dict] = None) -> Dict:
        """Make request to an Apple Music proxy service."""
        if not self.proxy_base_url:
            raise ValueError("Proxy base URL not configured")

        if not self._client:
            self._client = httpx.AsyncClient(timeout=30.0)

        url = f"{self.proxy_base_url}{path}"
        headers = {}
        if self.proxy_api_key:
            headers["x-proxy-key"] = self.proxy_api_key

        response = await self._client.request(
            method="GET",
            url=url,
            headers=headers,
            params=params,
        )
        response.raise_for_status()
        return response.json()

    async def search_catalog(self, term: str, types: List[str] = None, limit: int = 5) -> Dict:
        """
        Search Apple Music catalog.

        Args:
            term: Search query (artist, track, etc.)
            types: Resource types to search (default: ['songs'])
            limit: Number of results (default: 5)

        Returns:
            Search results dictionary
        """
        if types is None:
            types = ['songs']

        params = {
            'term': term,
            'types': ','.join(types),
            'limit': limit
        }

        logger.debug(f"[AM API] Searching catalog: term='{term}', types={types}")
        if self.proxy_base_url:
            return await self._proxy_request('/v1/search', {
                "term": term,
                "types": ','.join(types),
                "limit": limit,
                "storefront": self.storefront,
            })
        return await self._make_request('GET', f'/catalog/{self.storefront}/search', params)

    async def lookup_by_isrc(self, isrc_codes: List[str]) -> Dict:
        """
        Lookup songs by ISRC codes (batch query).

        Args:
            isrc_codes: List of ISRC codes (max 25 per request per Apple's limits)

        Returns:
            Dictionary with ISOCC code mapped to song data
        """
        if len(isrc_codes) == 0:
            return {}

        if len(isrc_codes) > 25:
            logger.warning(f"[AM API] ISRC batch size > 25, truncating to first 25")
            isrc_codes = isrc_codes[:25]

        # Build ISRC filter (comma-separated)
        isrc_filter = ','.join(isrc_codes)

        params = {
            'filter[isrc]': isrc_filter
        }

        logger.debug(f"[AM API] ISRC lookup: {len(isrc_codes)} codes")
        if self.proxy_base_url:
            result = await self._proxy_request('/v1/isrc', {
                "codes": isrc_filter,
                "storefront": self.storefront,
            })
        else:
            result = await self._make_request('GET', f'/catalog/{self.storefront}/songs', params)

        # Return results (parse response structure)
        return result

    async def lookup_song_by_id(self, song_id: str) -> Dict:
        """
        Lookup song by Apple Music catalog ID.

        Args:
            song_id: Apple Music song ID

        Returns:
            Song data dictionary
        """
        logger.debug(f"[AM API] Song lookup by ID: {song_id}")
        if self.proxy_base_url:
            return await self._proxy_request(f'/v1/songs/{song_id}', {
                "storefront": self.storefront,
            })
        return await self._make_request('GET', f'/catalog/{self.storefront}/songs/{song_id}')

    async def lookup_album_with_tracks(self, album_id: str, storefront: Optional[str] = None) -> Dict:
        """
        Lookup album by Apple Music catalog ID, including its tracks.

        Args:
            album_id: Apple Music album catalog ID (numeric string)
            storefront: Optional storefront override (e.g. 'it', 'us')

        Returns:
            Album data dictionary with tracks included
        """
        sf = storefront or self.storefront
        logger.debug(f"[AM API] Album lookup by ID: {album_id} (storefront={sf})")
        if self.proxy_base_url:
            return await self._proxy_request(f'/v1/albums/{album_id}', {
                "storefront": sf,
            })
        return await self._make_request(
            'GET',
            f'/catalog/{sf}/albums/{album_id}',
            params={"include": "tracks"},
        )

    async def test_credentials(self) -> Tuple[bool, str]:
        """
        Test API credentials with a simple search.

        Returns:
            Tuple of (success: bool, message: str)
        """
        try:
            result = await self.search_catalog('The Beatles', types=['songs'], limit=1)

            # Check if results returned
            if 'results' in result and 'songs' in result['results']:
                songs = result['results']['songs']['data']
                if songs:
                    song_name = songs[0]['attributes']['name']
                    artist_name = songs[0]['attributes']['artistName']
                    return True, f"Success! Found: '{song_name}' by {artist_name}"
                else:
                    return True, "Success! Credentials valid (no results returned)"
            else:
                return False, "Invalid response format"

        except Exception as e:
            return False, f"Authentication failed: {str(e)}"

    def close(self):
        """Close HTTP client connections."""
        if self._client:
            # Note: Async client needs to be closed properly in async context
            # This is a placeholder for sync close method
            pass

    async def aclose(self):
        """Async close of HTTP client."""
        if self._client:
            await self._client.aclose()
            self._client = None
