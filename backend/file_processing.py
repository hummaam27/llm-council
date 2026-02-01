"""File processing utilities for PDFs and images."""

import base64
import os
from pathlib import Path
from typing import Optional, Dict, Any
from PIL import Image
import io

try:
    from PyPDF2 import PdfReader
except ImportError:
    PdfReader = None

from .config import UPLOADS_DIR


def ensure_uploads_dir():
    """Ensure the uploads directory exists."""
    Path(UPLOADS_DIR).mkdir(parents=True, exist_ok=True)


def extract_text_from_pdf(file_path: str) -> Optional[str]:
    """
    Extract text content from a PDF file.
    
    Args:
        file_path: Path to the PDF file
        
    Returns:
        Extracted text or None if extraction fails
    """
    if PdfReader is None:
        return None
        
    try:
        reader = PdfReader(file_path)
        text_parts = []
        
        for page_num, page in enumerate(reader.pages, 1):
            text = page.extract_text()
            if text.strip():
                text_parts.append(f"--- Page {page_num} ---\n{text}")
        
        return "\n\n".join(text_parts)
    except Exception as e:
        print(f"Error extracting text from PDF: {e}")
        return None


def encode_image_to_base64(file_path: str, max_size: tuple = (1024, 1024)) -> Optional[Dict[str, Any]]:
    """
    Encode an image to base64 and resize if needed.
    
    Args:
        file_path: Path to the image file
        max_size: Maximum dimensions (width, height) for resizing
        
    Returns:
        Dict with base64 data and metadata, or None if encoding fails
    """
    try:
        with Image.open(file_path) as img:
            # Convert to RGB if necessary (handles RGBA, P, etc.)
            if img.mode not in ('RGB', 'L'):
                img = img.convert('RGB')
            
            # Resize if image is too large
            if img.size[0] > max_size[0] or img.size[1] > max_size[1]:
                img.thumbnail(max_size, Image.Resampling.LANCZOS)
            
            # Save to bytes
            buffer = io.BytesIO()
            img.save(buffer, format='JPEG', quality=85)
            buffer.seek(0)
            
            # Encode to base64
            base64_data = base64.b64encode(buffer.read()).decode('utf-8')
            
            return {
                'base64': base64_data,
                'mime_type': 'image/jpeg',
                'width': img.size[0],
                'height': img.size[1]
            }
    except Exception as e:
        print(f"Error encoding image: {e}")
        return None


def get_file_info(file_path: str) -> Dict[str, Any]:
    """
    Get information about a file.
    
    Args:
        file_path: Path to the file
        
    Returns:
        Dict with file metadata
    """
    stat = os.stat(file_path)
    return {
        'size': stat.st_size,
        'name': os.path.basename(file_path),
        'extension': os.path.splitext(file_path)[1].lower()
    }


def process_uploaded_file(file_path: str, file_type: str) -> Optional[Dict[str, Any]]:
    """
    Process an uploaded file based on its type.
    
    Args:
        file_path: Path to the uploaded file
        file_type: Type of file ('pdf' or 'image')
        
    Returns:
        Dict with processed file data or None if processing fails
    """
    file_info = get_file_info(file_path)
    
    if file_type == 'pdf':
        text = extract_text_from_pdf(file_path)
        if text:
            return {
                'type': 'pdf',
                'name': file_info['name'],
                'size': file_info['size'],
                'text_content': text,
                'page_count': text.count('--- Page ')
            }
    elif file_type == 'image':
        image_data = encode_image_to_base64(file_path)
        if image_data:
            return {
                'type': 'image',
                'name': file_info['name'],
                'size': file_info['size'],
                'base64': image_data['base64'],
                'mime_type': image_data['mime_type'],
                'width': image_data['width'],
                'height': image_data['height']
            }
    
    return None
