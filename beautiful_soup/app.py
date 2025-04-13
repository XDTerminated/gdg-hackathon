from fastapi import FastAPI, Query, HTTPException
from fastapi.responses import JSONResponse  # Changed from PlainTextResponse
from bs4 import BeautifulSoup
import subprocess
import logging  # Added for logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()


def run_curl(url: str) -> str:
    logger.info(f"Attempting to fetch URL with curl: {url}")
    try:
        result = subprocess.run(
            ["curl", "-L", "-s", "-A", "Mozilla/5.0", url],  # Added -s for silent mode
            capture_output=True,
            text=True,
            timeout=15,  # Increased timeout slightly
            check=True,  # Raise exception on non-zero exit code
        )
        logger.info(f"Successfully fetched URL: {url}")
        return result.stdout
    except subprocess.CalledProcessError as e:
        error_message = f"curl error (Exit Code {e.returncode}): {e.stderr.strip()}"
        logger.error(f"{error_message} for URL: {url}")
        raise HTTPException(
            status_code=400, detail=error_message
        )  # Raise HTTP exception
    except subprocess.TimeoutExpired:
        error_message = "curl command timed out"
        logger.error(f"{error_message} for URL: {url}")
        raise HTTPException(
            status_code=408, detail=error_message
        )  # Raise HTTP exception
    except Exception as e:
        error_message = f"Exception during curl: {str(e)}"
        logger.error(f"{error_message} for URL: {url}")
        # Use a generic 500 error for unexpected issues
        raise HTTPException(status_code=500, detail=error_message)


# Changed to @app.post and removed response_class (default is JSONResponse)
@app.post("/")
async def get_page_text(
    url: str = Query(..., description="The URL of the webpage to fetch")
):
    try:
        # Fetch HTML (run_curl now raises exceptions on failure)
        html = run_curl(url)

        # Parse HTML and extract readable text
        logger.info(f"Parsing HTML for URL: {url}")
        soup = BeautifulSoup(
            html, "lxml"
        )  # Use lxml if available, otherwise 'html.parser'
        for tag in soup(
            ["script", "style", "nav", "footer", "aside"]
        ):  # Remove more non-content tags
            tag.decompose()
        text = soup.get_text(
            separator=" ", strip=True
        )  # Use space separator and strip whitespace
        # Basic cleaning - replace multiple spaces/newlines with a single space
        clean_text = " ".join(text.split())
        logger.info(
            f"Successfully extracted text (length: {len(clean_text)}) for URL: {url}"
        )

        # Return JSON response compatible with background.js
        return JSONResponse(content={"text": clean_text})

    except HTTPException as e:
        # Re-raise HTTPExceptions from run_curl or parsing
        raise e
    except Exception as e:
        # Catch potential BeautifulSoup errors or other issues
        error_message = f"Error processing URL {url}: {str(e)}"
        logger.error(error_message)
        raise HTTPException(status_code=500, detail=error_message)


# Note: For Hugging Face Spaces, ensure your requirements.txt includes:
# fastapi
# uvicorn
# beautifulsoup4
# lxml # Recommended parser
# requests # If you switch from curl to requests/httpx
# httpx # If you want to use async requests
