# File Upload Feature Implementation

## Overview
Implemented the ability to upload PDF documents and images to the LLM Council. Users can now attach files to their messages.
- **PDFs**: Text is automatically extracted and included in the context for the council models to analyze.
- **Images**: Images are uploaded and displayed in the chat. (Note: Visual analysis depends on model capabilities and is currently implemented as a placeholder in the prompt).

## Changes Made

### Backend Changes

#### 1. Dependencies (`pyproject.toml`)
- Added `python-multipart` for handling file uploads.
- Added `PyPDF2` for PDF text extraction.
- Added `Pillow` for image processing.

#### 2. Configuration (`backend/config.py`)
- Added `UPLOADS_DIR` setting pointing to `data/uploads`.

#### 3. File Processing (`backend/file_processing.py`)
- Created new module for handling file operations.
- `extract_text_from_pdf`: Extracts text content from uploaded PDFs.
- `encode_image_to_base64`: Processes images for potential future vision capabilities.
- `process_uploaded_file`: Orchestrates processing based on file type.

#### 4. API Endpoints (`backend/main.py`)
- Added `POST /api/upload`: Endpoint to handle file uploads.
  - Validates file types (PDF, PNG, JPG, GIF, WEBP).
  - Saves files to `data/uploads`.
  - Returns file metadata and extracted content.
- Updated `POST /api/conversations/{id}/message`: Accepts `attachments` parameter.
- Updated `POST /api/conversations/{id}/message/stream`: Accepts `attachments` parameter.

#### 5. Storage (`backend/storage.py`)
- Updated `add_user_message` to store attachment metadata in the conversation history.

#### 6. Council Logic (`backend/council.py`)
- Updated `stage1_collect_responses` to include attachment content in the prompt sent to models.
- PDFs: Full text content is appended to the user query.
- Images: Metadata is appended (Vision API integration ready).

### Frontend Changes

#### 7. API Client (`frontend/src/api.js`)
- Added `uploadFile(file)` method.
- Updated `sendMessageStream` to support attachments.

#### 8. Chat Interface (`frontend/src/components/ChatInterface.jsx`)
- Added file input (hidden) and attachment button (paperclip).
- Added attachment preview area for files ready to send.
- Added attachment display in user messages history.
- Implemented file upload state handling and error management.

#### 9. Styling (`frontend/src/components/ChatInterface.css`)
- Added styles for attachment previews, icons, and message bubbles.
- Improved input form layout to accommodate the new toolbar.

## Usage

1. **Upload**: Click the paperclip icon 📎 in the chat input area.
2. **Select**: Choose one or more PDF or image files.
3. **Preview**: Files appear above the input box. You can remove them with the × button.
4. **Send**: Type your message (optional) and click Send.
5. **Analysis**: 
   - The text from PDFs is extracted and sent to the council models.
   - The council will respond taking the document content into account.

## Next Steps for User

1. **Restart Backend**: The backend server must be restarted to load the new code and endpoints.
2. **Install Dependencies**: The new Python packages must be installed.
   - If using `uv`, this should happen automatically on next run or via `uv sync`.
