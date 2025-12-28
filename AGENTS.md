# AGENTS.md

This file contains guidelines and commands for agentic coding agents working in this repository.

## Project Overview

This is a Node.js ES module project called "hashbot2" that searches hashtags in Mastodon and posts summary toots. The project consists of:
- A CLI script (`main.js`) for daily hashtag monitoring and posting
- An Express web server (`server.js`) providing a dashboard API
- Modular utilities for API interactions, data processing, and text generation

## Build/Lint/Test Commands

### Current Commands
```bash
# Start the main CLI application
node main.js

# Start the web server
node server.js

# Install dependencies
npm install

# Test (currently no tests defined)
npm test
```

### Recommended Commands to Add
```bash
# Add to package.json scripts section:
"start": "node main.js",
"server": "node server.js",
"dev": "node server.js", 
"lint": "echo 'Add ESLint configuration'",
"test": "echo 'Add test framework'"
```

## Code Style Guidelines

### Module System
- **ES Modules Only**: Use `import/export` syntax consistently
- **File Extensions**: All modules must use `.js` extension in imports
- **Absolute Imports**: Use relative paths with `./` or `../` for local modules

### Import Organization
```javascript
// 1. Node.js built-in modules
import readline from 'readline';
import path from 'path';

// 2. Third-party dependencies  
import express from 'express';
import moment from 'moment-timezone';

// 3. Local application modules (alphabetical)
import { HASHTAGS } from './constants.js';
import { fetchTootsFromAPI } from './api.js';
import { sortTootsByRelevance } from './utils.js';
```

### Naming Conventions
- **Constants**: `UPPER_SNAKE_CASE` (exported constants)
- **Functions**: `camelCase` (async functions use `async function`)
- **Variables**: `camelCase`
- **Files**: `camelCase.js` (except `main.js`, `server.js`)
- **Environment Variables**: `UPPER_SNAKE_CASE`

### Error Handling
- **Try-Catch**: Always wrap async operations in try-catch blocks
- **Error Logging**: Use `console.error()` for error messages
- **Error Throwing**: Throw descriptive `Error` objects with context
- **Graceful Degradation**: Return null or empty arrays for non-critical failures

### Function Patterns
```javascript
// Export async functions with descriptive names
export async function fetchTootsFromAPI(hashtag, params) {
  try {
    const response = await M.get(`timelines/tag/${hashtag}`, params);
    return response;
  } catch (error) {
    console.error(`Error fetching toots from API: ${error}`);
    throw error;
  }
}
```

### Configuration Management
- **Environment Variables**: Use `.env` file for sensitive data
- **Config Module**: Centralize configuration in `config.js`
- **Constants Module**: Define application constants in `constants.js`

### API Integration
- **Mastodon API**: Use `mastodon-api` package with proper authentication
- **Fetch API**: Use native `fetch` for HTTP requests when appropriate
- **Response Handling**: Always check response.ok status and parse errors

### Data Processing
- **Immutable Operations**: Create new objects/arrays rather than mutating
- **Async Processing**: Use `Promise.all()` for parallel operations
- **Data Validation**: Check for required properties before processing

### Logging
- **Info Messages**: Use `console.log()` for general information
- **Error Messages**: Use `console.error()` for errors
- **Progress Messages**: Include context and counts in progress logs

### Code Structure
- **Single Responsibility**: Each function should have one clear purpose
- **Modular Design**: Separate concerns into different modules
- **Export Strategy**: Export only what's needed by other modules

### Portuguese Language Support
- **User Messages**: Console output and error messages in Portuguese
- **Comments**: Code comments should be in English for maintainability
- **Content**: Generated toot content is in Portuguese

## Cursor Rules Integration

The `.cursor/rules/senior-engineer-task-execution.mdc` rule applies to all tasks:

1. **Clarify Scope First**: Map out approach before implementation
2. **Locate Exact Code Insertion Point**: Identify precise files and lines
3. **Minimal, Contained Changes**: Only write code directly required
4. **Double Check Everything**: Review for correctness and side effects
5. **Deliver Clearly**: Summarize changes and list modified files

## Development Workflow

1. **Environment Setup**: Ensure `.env` file is configured with Mastodon credentials
2. **Dependency Management**: Use `npm` for package management
3. **Testing**: Currently no test framework - recommend adding Jest or similar
4. **Linting**: Currently no linter - recommend adding ESLint with ES module support

## Key Dependencies

- `express`: Web server framework
- `mastodon-api`: Mastodon API client
- `moment-timezone`: Date/time manipulation with timezone support
- `cors`: Cross-origin resource sharing
- `dotenv`: Environment variable management

## File Structure Best Practices

- Keep related functionality in separate modules
- Use descriptive file names that match their purpose
- Maintain clean separation between CLI, server, and utility code
- Store configuration and constants in dedicated files