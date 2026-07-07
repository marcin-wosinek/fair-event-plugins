# React Admin Pages Pattern

This document defines the standard pattern for building WordPress admin pages using React and REST API across all Fair Event Plugins.

## Overview

Admin pages in Fair Event Plugins follow a consistent architecture:

-   **Frontend**: React components using WordPress components (`@wordpress/components`)
-   **Backend**: REST API controllers extending `WP_REST_Controller`
-   **Communication**: `apiFetch` from `@wordpress/api-fetch` for all API calls
-   **Authentication**: WordPress nonce-based authentication (handled automatically by `apiFetch`)

## Architecture Diagram

```
WordPress Admin Menu (PHP)
         ↓
Admin Page Wrapper (PHP) - renders <div id="root">
         ↓
React Entry Point (JS) - finds root element
         ↓
React Admin Component - manages state & UI
         ↓ (apiFetch)
REST API Controller (PHP) - extends WP_REST_Controller
         ↓
Repository/Database Layer
```

## Directory Structure

```
plugin-name/
├── src/
│   ├── Admin/
│   │   ├── AdminHooks.php              # Menu registration & script enqueueing
│   │   ├── PageNamePage.php            # PHP page wrapper (renders root div)
│   │   └── page-name/
│   │       ├── index.js                # React entry point
│   │       ├── PageNameComponent.js    # Main React component
│   │       └── style.css               # Component styles (optional)
│   ├── API/
│   │   ├── RestHooks.php               # Central REST API registration
│   │   └── ResourceController.php      # REST controller
│   └── Core/
│       └── Plugin.php                  # Loads AdminHooks and RestHooks
├── build/
│   └── admin/
│       └── page-name/
│           ├── index.js                # Webpack built file
│           └── index.asset.php         # Asset metadata (deps, version)
└── webpack.config.cjs                  # Webpack configuration
```

## Implementation Steps

### 1. REST API Controller (PHP)

**Location**: `src/API/ResourceController.php`

Use the canonical controller template in
[REST_API_BACKEND.md](./REST_API_BACKEND.md#standard-endpoint-implementation-template)
— do not duplicate it here. For admin pages the key specifics are:

-   Extend `WP_REST_Controller`; namespace format `plugin-slug/v1`
-   Admin endpoints use `current_user_can( 'manage_options' )` in every
    `*_permissions_check` (NEVER `__return_true`)
-   Return `WP_REST_Response` with appropriate HTTP status codes; `WP_Error` for
    error responses
-   List endpoints take `page` / `per_page` args and return
    `{ items, total, page, per_page, total_pages }`

### 2. REST API Registration (PHP)

**Location**: `src/API/RestHooks.php`

```php
<?php
namespace PluginName\API;

class RestHooks {

    public function __construct() {
        add_action( 'rest_api_init', array( $this, 'register_routes' ) );
    }

    public function register_routes() {
        $resource_controller = new ResourceController();
        $resource_controller->register_routes();

        // Register other controllers here
    }
}
```

**Location**: `src/Core/Plugin.php`

```php
<?php
namespace PluginName\Core;

class Plugin {
    private static $instance = null;

    public static function instance() {
        if ( null === self::$instance ) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function init() {
        $this->load_hooks();
    }

    private function load_hooks() {
        new \PluginName\Hooks\BlockHooks();
        new \PluginName\Admin\AdminHooks();
        new \PluginName\API\RestHooks();  // Register REST API
    }
}
```

### 3. Admin Hooks (PHP)

**Location**: `src/Admin/AdminHooks.php`

```php
<?php
namespace PluginName\Admin;

class AdminHooks {

    public function __construct() {
        add_action( 'admin_menu', array( $this, 'register_admin_menu' ) );
        add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_admin_scripts' ) );
    }

    /**
     * Register admin menu pages
     */
    public function register_admin_menu() {
        // Main menu page
        add_menu_page(
            __( 'Plugin Name', 'plugin-name' ),           // Page title
            __( 'Plugin Name', 'plugin-name' ),           // Menu title
            'manage_options',                             // Capability
            'plugin-name',                                // Menu slug
            array( $this, 'render_main_page' ),           // Callback
            'dashicons-admin-generic',                    // Icon
            30                                            // Position
        );

        // Submenu pages
        add_submenu_page(
            'plugin-name',                                // Parent slug
            __( 'Resources', 'plugin-name' ),             // Page title
            __( 'Resources', 'plugin-name' ),             // Menu title
            'manage_options',                             // Capability
            'plugin-name-resources',                      // Menu slug
            array( $this, 'render_resources_page' )       // Callback
        );
    }

    /**
     * Render admin page
     */
    public function render_main_page() {
        $page = new MainPage();
        $page->render();
    }

    public function render_resources_page() {
        $page = new ResourcesPage();
        $page->render();
    }

    /**
     * Enqueue admin scripts
     */
    public function enqueue_admin_scripts( $hook ) {
        $plugin_dir = plugin_dir_path( dirname( __DIR__ ) );

        // Main page scripts
        if ( 'toplevel_page_plugin-name' === $hook ) {
            $this->enqueue_admin_page_scripts( 'main', $plugin_dir );
        }

        // Resources page scripts
        if ( 'plugin-name_page_plugin-name-resources' === $hook ) {
            $this->enqueue_admin_page_scripts( 'resources', $plugin_dir );
        }
    }

    /**
     * Helper to enqueue scripts for a specific admin page
     */
    private function enqueue_admin_page_scripts( $page_name, $plugin_dir ) {
        $asset_file = $plugin_dir . "build/admin/{$page_name}/index.asset.php";

        if ( ! file_exists( $asset_file ) ) {
            return;
        }

        $asset_data = include $asset_file;

        // Enqueue script
        wp_enqueue_script(
            "plugin-name-{$page_name}",
            plugin_dir_url( dirname( __DIR__ ) ) . "build/admin/{$page_name}/index.js",
            $asset_data['dependencies'],
            $asset_data['version'],
            true
        );

        // Set translations
        wp_set_script_translations(
            "plugin-name-{$page_name}",
            'plugin-name',
            $plugin_dir . 'build/languages'
        );

        // Enqueue WordPress component styles
        wp_enqueue_style( 'wp-components' );

        // Optionally enqueue custom styles
        $style_file = plugin_dir_url( dirname( __DIR__ ) ) . "build/admin/{$page_name}/style-index.css";
        if ( file_exists( $plugin_dir . "build/admin/{$page_name}/style-index.css" ) ) {
            wp_enqueue_style(
                "plugin-name-{$page_name}",
                $style_file,
                array( 'wp-components' ),
                $asset_data['version']
            );
        }
    }
}
```

**Key Points**:

-   Use `admin_menu` hook for menu registration
-   Use `admin_enqueue_scripts` hook with `$hook` parameter to enqueue conditionally
-   Always load asset metadata from `build/admin/*/index.asset.php`
-   Set translations using `wp_set_script_translations()` pointing to `build/languages/`
-   Always enqueue `wp-components` stylesheet

### 4. PHP Page Wrapper

**Location**: `src/Admin/ResourcesPage.php`

```php
<?php
namespace PluginName\Admin;

class ResourcesPage {

    /**
     * Render the admin page
     */
    public function render() {
        ?>
        <div id="plugin-name-resources-root"></div>
        <?php
    }
}
```

**Key Points**:

-   Minimal PHP wrapper that outputs a single root div
-   Use consistent naming: `plugin-slug-page-name-root`
-   React will mount to this element

### 5. React Entry Point

**Location**: `src/Admin/resources/index.js`

**Pattern 1: Using domReady (Simpler, used in most admin pages)**

```javascript
import domReady from '@wordpress/dom-ready';
import { render } from '@wordpress/element';
import ResourcesPage from './ResourcesPage.js';

// Render the app when DOM is ready
domReady(() => {
	const rootElement = document.getElementById('plugin-name-resources-root');
	if (rootElement) {
		render(<ResourcesPage />, rootElement);
	}
});
```

**Pattern 2: Using createRoot with Defensive DOM Check (Modern, recommended)**

```javascript
import { createRoot } from '@wordpress/element';
import ResourcesPage from './ResourcesPage.js';

// Defensive: handle both scenarios (DOM loading or already loaded)
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', initializeApp);
} else {
	initializeApp();
}

function initializeApp() {
	const rootElement = document.getElementById('plugin-name-resources-root');
	if (!rootElement) {
		return;
	}

	// Pass data from PHP via dataset attributes
	const initialData = {
		userId: parseInt(rootElement.dataset.userId, 10),
		// ... other data from PHP
	};

	const root = createRoot(rootElement);
	root.render(<ResourcesPage {...initialData} />);
}
```

**Key Points**:

-   Always check if root element exists before rendering
-   Use defensive DOM ready pattern (see CLAUDE.md)
-   Pass initial data from PHP via `dataset` attributes
-   Import from `@wordpress/element`, not `react` directly

### 6. React Admin Component

**Location**: `src/Admin/resources/ResourcesPage.js`

```javascript
import { useState, useEffect } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	Card,
	CardHeader,
	CardBody,
	Button,
	Spinner,
	Notice,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';

const ResourcesPage = () => {
	const [resources, setResources] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);
	const [page, setPage] = useState(1);
	const [totalPages, setTotalPages] = useState(1);

	// Load resources on mount and when page changes
	useEffect(() => {
		loadResources();
	}, [page]);

	const loadResources = async () => {
		setLoading(true);
		setError(null);

		try {
			const params = new URLSearchParams({
				page: page.toString(),
				per_page: '50',
			});

			// Use apiFetch with hardcoded path
			const response = await apiFetch({
				path: `/plugin-name/v1/resources?${params.toString()}`,
			});

			setResources(response.items || []);
			setTotalPages(response.total_pages || 1);
		} catch (err) {
			// Extract error message
			const errorMessage =
				err.message || __('Failed to load resources.', 'plugin-name');
			setError(errorMessage);
		} finally {
			setLoading(false);
		}
	};

	const handleCreate = async (resourceData) => {
		try {
			const response = await apiFetch({
				path: '/plugin-name/v1/resources',
				method: 'POST',
				data: resourceData,
			});

			// Reload data after successful creation
			loadResources();

			return response;
		} catch (err) {
			throw new Error(
				err.message || __('Failed to create resource.', 'plugin-name')
			);
		}
	};

	const handleUpdate = async (id, resourceData) => {
		try {
			const response = await apiFetch({
				path: `/plugin-name/v1/resources/${id}`,
				method: 'PUT',
				data: resourceData,
			});

			// Update local state
			setResources((prev) =>
				prev.map((resource) =>
					resource.id === id
						? { ...resource, ...resourceData }
						: resource
				)
			);

			return response;
		} catch (err) {
			throw new Error(
				err.message || __('Failed to update resource.', 'plugin-name')
			);
		}
	};

	// Destructive actions: confirm via ConfirmDialog naming the object —
	// never window.confirm/alert. See UI_GUIDELINES.md.
	const handleDelete = async (id) => {
		try {
			await apiFetch({
				path: `/plugin-name/v1/resources/${id}`,
				method: 'DELETE',
			});

			// Remove from local state
			setResources((prev) =>
				prev.filter((resource) => resource.id !== id)
			);
		} catch (err) {
			setError(
				err.message || __('Failed to delete resource.', 'plugin-name')
			);
		}
	};

	if (loading) {
		return (
			<div className="wrap">
				<h1>{__('Resources', 'plugin-name')}</h1>
				<Spinner />
			</div>
		);
	}

	return (
		<div className="wrap">
			<h1>{__('Resources', 'plugin-name')}</h1>

			{error && (
				<Notice status="error" isDismissible={false}>
					{error}
				</Notice>
			)}

			<Card>
				<CardHeader>
					<h2>{__('All Resources', 'plugin-name')}</h2>
					<Button
						variant="primary"
						onClick={() => handleCreate({ name: 'New Resource' })}
					>
						{__('Add New', 'plugin-name')}
					</Button>
				</CardHeader>

				<CardBody>
					{resources.length === 0 ? (
						<p>{__('No resources found.', 'plugin-name')}</p>
					) : (
						<table className="wp-list-table widefat fixed striped">
							<thead>
								<tr>
									<th>{__('ID', 'plugin-name')}</th>
									<th>{__('Name', 'plugin-name')}</th>
									<th>{__('Actions', 'plugin-name')}</th>
								</tr>
							</thead>
							<tbody>
								{resources.map((resource) => (
									<tr key={resource.id}>
										<td>{resource.id}</td>
										<td>{resource.name}</td>
										<td>
											<Button
												variant="secondary"
												onClick={() =>
													handleUpdate(resource.id, {
														name: 'Updated',
													})
												}
											>
												{__('Edit', 'plugin-name')}
											</Button>
											<Button
												variant="tertiary"
												isDestructive
												onClick={() =>
													handleDelete(resource.id)
												}
											>
												{__('Delete', 'plugin-name')}
											</Button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					)}

					{totalPages > 1 && (
						<HStack>
							<Button
								variant="secondary"
								disabled={page === 1}
								onClick={() => setPage(page - 1)}
							>
								{__('Previous', 'plugin-name')}
							</Button>
							<span>
								{__('Page', 'plugin-name')} {page} /{' '}
								{totalPages}
							</span>
							<Button
								variant="secondary"
								disabled={page === totalPages}
								onClick={() => setPage(page + 1)}
							>
								{__('Next', 'plugin-name')}
							</Button>
						</HStack>
					)}
				</CardBody>
			</Card>
		</div>
	);
};

export default ResourcesPage;
```

**Key Points**:

-   Import from `@wordpress/element`, not `react`
-   Use `@wordpress/components` for UI elements
-   Use `@wordpress/i18n` for translations
-   Use `apiFetch` with hardcoded paths (always start with `/`)
-   Implement proper loading states and error handling
-   Use optimistic UI updates where appropriate
-   Follow WordPress admin UI conventions (`.wrap`, `.wp-list-table`, etc.)

### 7. Webpack Configuration

**Location**: `webpack.config.cjs`

```javascript
const defaultConfig = require('@wordpress/scripts/config/webpack.config');
const path = require('path');

module.exports = {
	...defaultConfig,
	entry: {
		...defaultConfig.entry,
		// Admin pages
		'admin/resources/index': path.resolve(
			__dirname,
			'src/Admin/resources/index.js'
		),
		'admin/settings/index': path.resolve(
			__dirname,
			'src/Admin/settings/index.js'
		),
	},
};
```

**Key Points**:

-   Extend WordPress Scripts webpack config
-   Use descriptive entry point paths: `admin/page-name/index`
-   Webpack generates `.asset.php` files automatically
-   Built files go to `build/admin/page-name/index.js`

## Best Practices

### apiFetch Usage

✅ **DO**:

```javascript
// Use hardcoded paths starting with /
const data = await apiFetch({
	path: '/plugin-name/v1/resources',
});

// Include query parameters
const params = new URLSearchParams({ page: '1', per_page: '50' });
const data = await apiFetch({
	path: `/plugin-name/v1/resources?${params.toString()}`,
});

// Specify HTTP method for mutations
await apiFetch({
	path: '/plugin-name/v1/resources',
	method: 'POST',
	data: { name: 'New Resource' },
});
```

❌ **DON'T**:

```javascript
// Never use fetch() directly for WordPress REST API
fetch('/wp-json/plugin-name/v1/resources'); // ❌

// Never use dynamic URL construction
const url = rest_url('plugin-name/v1/resources'); // ❌

// Never forget the leading /
apiFetch({ path: 'plugin-name/v1/resources' }); // ❌
```

### Error Handling

```javascript
try {
	const response = await apiFetch({ path: '/plugin-name/v1/resources' });
	setData(response);
} catch (err) {
	// Extract message from error object
	const errorMessage =
		err.message || __('Failed to load data.', 'plugin-name');
	setError(errorMessage);
}
```

### Permission Callbacks

✅ **DO**:

```php
// Admin endpoints require manage_options capability
'permission_callback' => function() {
    return current_user_can( 'manage_options' );
}

// Or use a class method
'permission_callback' => array( $this, 'check_permission' )
```

❌ **DON'T**:

```php
// NEVER use __return_true for admin endpoints
'permission_callback' => '__return_true'  // ❌ Security vulnerability!
```

### Loading States

Always show loading states and handle errors:

```javascript
if (loading) {
	return <Spinner />;
}

if (error) {
	return <Notice status="error">{error}</Notice>;
}

// Render data
```

### State Management

-   Use `useState` for local component state
-   Use `useEffect` for data fetching
-   Update local state optimistically after mutations
-   Reload data after create/delete operations

### WordPress Components

Use WordPress components for consistent UI:

```javascript
import {
	Card,
	CardHeader,
	CardBody,
	Button,
	Spinner,
	Notice,
	TextControl,
	SelectControl,
	CheckboxControl,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
```

## Example Implementations

### fair-audience (Most Complete — canonical)

-   **Location**: `fair-audience/src/Admin/` (events-list, event-participants,
    all-participants, fees-list, collaborators, custom-mail, and more)
-   **REST API**: `fair-audience/src/API/` (EventParticipantsController,
    FeesController, …)
-   **Features**: Pagination, filtering, inline editing, shared components in
    `fair-audience/src/Admin/components/`

### fair-events

-   **Location**: `fair-events/src/Admin/`
-   **REST API**: `fair-events/src/API/` (EventDatesController,
    TicketsController, …)

### fair-payments-connector

-   **Location**: `fair-payments-connector/src/Admin/settings/`
-   **Page**: Settings (Mollie API configuration)
-   **Features**: Form with validation

## Adding a New Admin Page

1. **Create REST API Controller** in `src/API/ResourceController.php`
2. **Register REST API** in `src/API/RestHooks.php`
3. **Create Admin Hooks** in `src/Admin/AdminHooks.php`
4. **Create Page Wrapper** in `src/Admin/ResourcesPage.php`
5. **Create React Entry Point** in `src/Admin/resources/index.js`
6. **Create React Component** in `src/Admin/resources/ResourcesPage.js`
7. **Update Webpack Config** to include new entry point
8. **Build** with `npm run build`
9. **Test** admin page and API endpoints

## Testing

See [TESTING.md](./TESTING.md) for comprehensive testing guidelines:

-   **Component Tests**: Jest + React Testing Library
-   **API Tests**: Playwright for REST endpoints
-   **E2E Tests**: Playwright for complete user flows

## Security Checklist

-   [ ] REST API uses `WP_REST_Controller` base class
-   [ ] All endpoints have proper `permission_callback`
-   [ ] Admin endpoints use `current_user_can( 'manage_options' )`
-   [ ] Input validation and sanitization in PHP
-   [ ] WordPress nonce handled automatically by `apiFetch`
-   [ ] Never use `__return_true` for authenticated endpoints

## Common Patterns

### Pagination

```javascript
const [page, setPage] = useState(1);
const [totalPages, setTotalPages] = useState(1);

useEffect(() => {
	const params = new URLSearchParams({
		page: page.toString(),
		per_page: '50',
	});

	apiFetch({
		path: `/plugin-name/v1/resources?${params.toString()}`,
	}).then((response) => {
		setItems(response.items);
		setTotalPages(response.total_pages);
	});
}, [page]);
```

### Filtering

```javascript
const [statusFilter, setStatusFilter] = useState('');

useEffect(() => {
	const params = new URLSearchParams({
		page: page.toString(),
		per_page: '50',
	});

	if (statusFilter) {
		params.append('status', statusFilter);
	}

	apiFetch({
		path: `/plugin-name/v1/resources?${params.toString()}`,
	}).then(setItems);
}, [statusFilter, page]);
```

### Optimistic Updates

```javascript
const handleToggle = async (id, currentValue) => {
	// Optimistic update
	setItems((prev) =>
		prev.map((item) =>
			item.id === id ? { ...item, active: !currentValue } : item
		)
	);

	try {
		await apiFetch({
			path: `/plugin-name/v1/resources/${id}`,
			method: 'PUT',
			data: { active: !currentValue },
		});
	} catch (err) {
		// Revert on error; report via a Notice, not alert() (UI_GUIDELINES.md)
		setItems((prev) =>
			prev.map((item) =>
				item.id === id ? { ...item, active: currentValue } : item
			)
		);
		setError(err.message);
	}
};
```

### Form Handling

```javascript
const [formData, setFormData] = useState({ name: '', email: '' });
const [isSaving, setIsSaving] = useState(false);

const handleSubmit = async (e) => {
	e.preventDefault();
	setIsSaving(true);

	try {
		await apiFetch({
			path: '/plugin-name/v1/resources',
			method: 'POST',
			data: formData,
		});

		// Reset form
		setFormData({ name: '', email: '' });
	} catch (err) {
		setError(err.message);
	} finally {
		setIsSaving(false);
	}
};
```

## See Also

-   [UI_GUIDELINES.md](./UI_GUIDELINES.md) - UX rules for admin pages (labels, save model, destructive actions, dates)
-   [REST_API_USAGE.md](./REST_API_USAGE.md) - Frontend REST API integration
-   [REST_API_BACKEND.md](./REST_API_BACKEND.md) - Backend REST API security standards
-   [TESTING.md](./TESTING.md) - Testing architecture
-   [CLAUDE.md](./CLAUDE.md) - General project guidelines
