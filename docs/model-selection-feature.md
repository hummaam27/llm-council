# OpenRouter Model Selection Feature

## Overview
Added the ability to dynamically select council members and chairman from OpenRouter models, filtered to show only OpenAI, Anthropic, and Google models.

## Backend Changes

### 1. OpenRouter API Integration (`backend/openrouter.py`)
- Added `fetch_available_models()` function to retrieve all available models from OpenRouter API

### 2. New API Endpoints (`backend/main.py`)
- **GET `/api/openrouter/models`**: Fetches and filters models from OpenAI, Anthropic, and Google
- **GET `/api/council/config`**: Returns current council configuration
- **POST `/api/council/config`**: Updates council configuration with selected models

## Frontend Changes

### 1. API Client (`frontend/src/api.js`)
Added three new methods:
- `getOpenRouterModels()`: Fetch filtered models
- `getCouncilConfig()`: Get current configuration
- `updateCouncilConfig()`: Save new configuration

### 2. New Components

#### CouncilConfig Component (`frontend/src/components/CouncilConfig.jsx`)
Main configuration modal that allows users to:
- Select multiple council member models
- Select a chairman model
- Save configuration to backend

Features:
- Displays currently selected models
- Opens ModelPicker for council members
- Opens SingleModelPicker for chairman
- Validates that at least one council model and one chairman are selected

### 3. Updated Components

#### Sidebar (`frontend/src/components/Sidebar.jsx`)
- Added config button (⚙️) to open council configuration modal
- Updated layout to accommodate both config and new conversation buttons

#### App (`frontend/src/App.jsx`)
- Integrated CouncilConfig component
- Added state management for config modal
- Wired up handlers for opening/closing config

## How to Use

1. **Start the application** (backend and frontend must be running)

2. **Click the config button (⚙️)** in the sidebar

3. **Select Council Members**:
   - Click "Select Council Models"
   - Browse and filter models from OpenAI, Anthropic, and Google
   - Select multiple models to participate in the council
   - Click "Done"

4. **Select Chairman Model**:
   - Click "Select Chairman Model"
   - Choose one model to synthesize the final response
   - Click "Done"

5. **Save Configuration**:
   - Click "Save Configuration"
   - The new models will be used for all subsequent conversations

## Model Filtering

The system automatically filters to show only models from:
- **OpenAI**: Models starting with `openai/`
- **Anthropic**: Models starting with `anthropic/`
- **Google**: Models starting with `google/`

Each model displays:
- Model name
- Provider
- Context length
- Pricing per million tokens
- Description

## Technical Notes

- Configuration is stored in memory on the backend (resets on server restart)
- The existing ModelPicker and SingleModelPicker components are reused
- All models are fetched from OpenRouter's live API
- Requires valid OPENROUTER_API_KEY in environment variables
