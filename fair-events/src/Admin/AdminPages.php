<?php
/**
 * Admin Pages for Fair Events
 *
 * @package FairEvents
 */

namespace FairEvents\Admin;

defined( 'WPINC' ) || die;

/**
 * Admin Pages class for registering admin menu pages
 */
class AdminPages {
	/**
	 * Initialize admin pages
	 *
	 * @return void
	 */
	public function init() {
		add_action( 'admin_menu', array( $this, 'register_admin_pages' ) );
		add_action( 'admin_menu', array( $this, 'reorder_admin_menu' ), 999 );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_admin_scripts' ) );
		add_action( 'pre_get_posts', array( $this, 'filter_upcoming_events' ) );
		add_action( 'admin_bar_menu', array( $this, 'add_copy_button_to_admin_bar' ), 100 );
	}

	/**
	 * Register admin menu pages
	 *
	 * @return void
	 */
	public function register_admin_pages() {
		// Upcoming Events page (redirect to filtered list)
		add_submenu_page(
			'edit.php?post_type=fair_event',
			__( 'Upcoming Events', 'fair-events' ),
			__( 'Upcoming', 'fair-events' ),
			'edit_posts',
			'edit.php?post_type=fair_event&upcoming=1'
		);

		// Settings page
		add_submenu_page(
			'edit.php?post_type=fair_event',
			__( 'Fair Events Settings', 'fair-events' ),
			__( 'Settings', 'fair-events' ),
			'manage_options',
			'fair-events-settings',
			array( $this, 'render_settings_page' )
		);

		// Import page
		add_submenu_page(
			'edit.php?post_type=fair_event',
			__( 'Import Events', 'fair-events' ),
			__( 'Import', 'fair-events' ),
			'manage_options',
			'fair-events-import',
			array( $this, 'render_import_page' )
		);

		// Event Sources page
		add_submenu_page(
			'edit.php?post_type=fair_event',
			__( 'Event Sources', 'fair-events' ),
			__( 'Event Sources', 'fair-events' ),
			'manage_options',
			'fair-events-sources',
			array( $this, 'render_sources_page' )
		);

		// Copy Event page (hidden from menu, accessed via row action)
		$copy_hookname = add_submenu_page(
			'', // Hidden from menu (empty string instead of null for PHP 8.1+ compatibility)
			__( 'Copy Event', 'fair-events' ),
			__( 'Copy Event', 'fair-events' ),
			'edit_posts',
			'fair-events-copy',
			array( $this, 'render_copy_event_page' )
		);

		// Handle copy event form submission before page render
		add_action( 'load-' . $copy_hookname, array( $this, 'handle_copy_event_submission' ) );
	}

	/**
	 * Enqueue admin scripts
	 *
	 * @param string $hook Current admin page hook.
	 * @return void
	 */
	public function enqueue_admin_scripts( $hook ) {
		// Event Sources page
		if ( 'fair_event_page_fair-events-sources' === $hook ) {
			$asset_file = include FAIR_EVENTS_PLUGIN_DIR . 'build/admin/sources/index.asset.php';

			wp_enqueue_script(
				'fair-events-sources',
				FAIR_EVENTS_PLUGIN_URL . 'build/admin/sources/index.js',
				$asset_file['dependencies'],
				$asset_file['version'],
				true
			);

			wp_set_script_translations(
				'fair-events-sources',
				'fair-events',
				FAIR_EVENTS_PLUGIN_DIR . 'build/languages'
			);

			wp_enqueue_style( 'wp-components' );
			return;
		}

		// Only load on Fair Events admin pages.
		if ( 'fair_event_page_fair-events-settings' !== $hook && 'fair_event_page_fair-events-import' !== $hook ) {
			return;
		}

		$asset_file = include FAIR_EVENTS_PLUGIN_DIR . 'build/admin/settings/index.asset.php';

		if ( 'fair_event_page_fair-events-settings' === $hook ) {
			wp_enqueue_script(
				'fair-events-settings',
				FAIR_EVENTS_PLUGIN_URL . 'build/admin/settings/index.js',
				$asset_file['dependencies'],
				$asset_file['version'],
				true
			);

			wp_set_script_translations(
				'fair-events-settings',
				'fair-events',
				FAIR_EVENTS_PLUGIN_DIR . 'build/languages'
			);

			wp_enqueue_style( 'wp-components' );
		}
	}

	/**
	 * Render settings page
	 *
	 * @return void
	 */
	public function render_settings_page() {
		?>
		<div id="fair-events-settings-root"></div>
		<?php
	}

	/**
	 * Render import page
	 *
	 * @return void
	 */
	public function render_import_page() {
		?>
		<div class="wrap">
			<h1><?php echo esc_html( get_admin_page_title() ); ?></h1>
		</div>
		<?php
	}

	/**
	 * Render event sources page
	 *
	 * @return void
	 */
	public function render_sources_page() {
		?>
		<div id="fair-events-sources-root"></div>
		<?php
	}

	/**
	 * Handle copy event form submission
	 *
	 * @return void
	 */
	public function handle_copy_event_submission() {
		// Only process if form was submitted
		if ( ! isset( $_POST['copy_event_submit'] ) ) {
			return;
		}

		$copy_page = new CopyEventPage();
		$copy_page->handle_submission();
	}

	/**
	 * Render copy event page
	 *
	 * @return void
	 */
	public function render_copy_event_page() {
		$copy_page = new CopyEventPage();
		$copy_page->render();
	}

	/**
	 * Reorder admin menu to put Upcoming before All Events
	 *
	 * @return void
	 */
	public function reorder_admin_menu() {
		global $submenu;

		$parent_slug = 'edit.php?post_type=fair_event';

		if ( ! isset( $submenu[ $parent_slug ] ) ) {
			return;
		}

		// Find the Upcoming Events item
		$upcoming_item = null;
		$upcoming_key  = null;

		foreach ( $submenu[ $parent_slug ] as $key => $item ) {
			if ( isset( $item[2] ) && strpos( $item[2], 'upcoming=1' ) !== false ) {
				$upcoming_item = $item;
				$upcoming_key  = $key;
				break;
			}
		}

		if ( $upcoming_item && $upcoming_key !== null ) {
			// Remove Upcoming from current position
			unset( $submenu[ $parent_slug ][ $upcoming_key ] );

			// Insert at position 1 (right after the parent item at position 0)
			$new_submenu = array();
			$position    = 0;

			foreach ( $submenu[ $parent_slug ] as $key => $item ) {
				if ( 1 === $position ) {
					$new_submenu[] = $upcoming_item;
				}
				$new_submenu[] = $item;
				++$position;
			}

			// If there was only one item, add Upcoming at position 1
			if ( 0 === $position ) {
				$new_submenu[] = $upcoming_item;
			}

			$submenu[ $parent_slug ] = $new_submenu;
		}
	}

	/**
	 * Filter events to show only upcoming ones
	 *
	 * @param \WP_Query $query The query object.
	 * @return void
	 */
	public function filter_upcoming_events( $query ) {
		// Only on admin, main query, for fair_event post type
		if ( ! is_admin() || ! $query->is_main_query() || 'fair_event' !== $query->get( 'post_type' ) ) {
			return;
		}

		// Check if upcoming filter is active
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended
		if ( ! isset( $_GET['upcoming'] ) || '1' !== $_GET['upcoming'] ) {
			return;
		}

		// Get current datetime in same format as event_start
		$current_datetime = current_time( 'mysql' );

		// Filter: event_start >= now
		$meta_query = array(
			array(
				'key'     => 'event_start',
				'value'   => $current_datetime,
				'compare' => '>=',
				'type'    => 'DATETIME',
			),
		);

		$query->set( 'meta_query', $meta_query );

		// Order by event_start ASC (earliest first)
		$query->set( 'meta_key', 'event_start' );
		$query->set( 'orderby', 'meta_value' );
		$query->set( 'order', 'ASC' );
	}

	/**
	 * Add Copy button to admin bar on event edit pages
	 *
	 * @param \WP_Admin_Bar $wp_admin_bar The admin bar object.
	 * @return void
	 */
	public function add_copy_button_to_admin_bar( $wp_admin_bar ) {
		// Only show on event edit pages in admin
		if ( ! is_admin() ) {
			return;
		}

		$screen = get_current_screen();
		if ( ! $screen || 'fair_event' !== $screen->post_type || 'post' !== $screen->base ) {
			return;
		}

		// Get current post ID
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$post_id = isset( $_GET['post'] ) ? absint( $_GET['post'] ) : 0;
		if ( ! $post_id ) {
			return;
		}

		// Verify it's a fair_event post
		$post = get_post( $post_id );
		if ( ! $post || 'fair_event' !== $post->post_type ) {
			return;
		}

		// Check user permissions
		if ( ! current_user_can( 'edit_posts' ) ) {
			return;
		}

		// Build copy URL with nonce
		$copy_url = add_query_arg(
			array(
				'page'     => 'fair-events-copy',
				'event_id' => $post_id,
				'_wpnonce' => wp_create_nonce( 'copy_fair_event_' . $post_id ),
			),
			admin_url( 'admin.php' )
		);

		// Add the Copy button
		$wp_admin_bar->add_node(
			array(
				'id'    => 'copy-event',
				'title' => __( 'Copy', 'fair-events' ),
				'href'  => $copy_url,
				'meta'  => array(
					'title' => __( 'Copy this event', 'fair-events' ),
				),
			)
		);
	}
}
