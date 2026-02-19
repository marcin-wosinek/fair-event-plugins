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

		// Calendar page
		add_submenu_page(
			'edit.php?post_type=fair_event',
			__( 'Events Calendar', 'fair-events' ),
			__( 'Calendar', 'fair-events' ),
			'edit_posts',
			'fair-events-calendar',
			array( $this, 'render_calendar_page' )
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

		// Migration page
		add_submenu_page(
			'edit.php?post_type=fair_event',
			__( 'Migrate Posts to Events', 'fair-events' ),
			__( 'Migrate Posts', 'fair-events' ),
			'manage_options',
			'fair-events-migration',
			array( $this, 'render_migration_page' )
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

		// Venues page
		add_submenu_page(
			'edit.php?post_type=fair_event',
			__( 'Venues', 'fair-events' ),
			__( 'Venues', 'fair-events' ),
			'manage_options',
			'fair-events-venues',
			array( $this, 'render_venues_page' )
		);

		// Manage Event page (hidden from menu, accessed via calendar)
		$manage_hookname = add_submenu_page(
			'', // Hidden from menu (empty string instead of null for PHP 8.1+ compatibility)
			__( 'Manage Event', 'fair-events' ),
			__( 'Manage Event', 'fair-events' ),
			'edit_posts',
			'fair-events-manage-event',
			array( $this, 'render_manage_event_page' )
		);

		// Source View page (hidden from menu, accessed via sources list)
		$source_view_hookname = add_submenu_page(
			'', // Hidden from menu (empty string instead of null for PHP 8.1+ compatibility)
			__( 'View Source', 'fair-events' ),
			__( 'View Source', 'fair-events' ),
			'manage_options',
			'fair-events-source-view',
			array( $this, 'render_source_view_page' )
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

		// Set page titles for hidden pages to prevent strip_tags() deprecation warning.
		$this->set_hidden_page_title( $manage_hookname, __( 'Manage Event', 'fair-events' ) );
		$this->set_hidden_page_title( $source_view_hookname, __( 'View Source', 'fair-events' ) );
		$this->set_hidden_page_title( $copy_hookname, __( 'Copy Event', 'fair-events' ) );

		// Handle copy event form submission before page render
		add_action( 'load-' . $copy_hookname, array( $this, 'handle_copy_event_submission' ) );
	}

	/**
	 * Set the page title for a hidden admin page.
	 *
	 * Hidden pages (registered with empty parent slug) are not in the submenu array,
	 * so WordPress cannot find their title. This causes $title to be null when
	 * admin-header.php calls strip_tags(), triggering a PHP 8.1+ deprecation warning.
	 *
	 * @param string $hookname The page hook name returned by add_submenu_page().
	 * @param string $page_title The title to set.
	 * @return void
	 */
	private function set_hidden_page_title( $hookname, $page_title ) {
		add_action(
			'load-' . $hookname,
			static function () use ( $page_title ) {
				global $title;
				// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
				$title = $page_title;
			}
		);
	}

	/**
	 * Enqueue admin scripts
	 *
	 * @param string $hook Current admin page hook.
	 * @return void
	 */
	public function enqueue_admin_scripts( $hook ) {
		// Calendar page
		if ( 'fair_event_page_fair-events-calendar' === $hook ) {
			$asset_file = include FAIR_EVENTS_PLUGIN_DIR . 'build/admin/calendar/index.asset.php';

			wp_enqueue_script(
				'fair-events-calendar',
				FAIR_EVENTS_PLUGIN_URL . 'build/admin/calendar/index.js',
				$asset_file['dependencies'],
				$asset_file['version'],
				true
			);

			wp_enqueue_style(
				'fair-events-calendar',
				FAIR_EVENTS_PLUGIN_URL . 'build/admin/calendar/style-index.css',
				array( 'wp-components' ),
				$asset_file['version']
			);

			$calendar_data = array(
				'startOfWeek'    => (int) get_option( 'start_of_week', 1 ),
				'newEventUrl'    => admin_url( 'post-new.php?post_type=fair_event' ),
				'editEventUrl'   => admin_url( 'post.php?action=edit&post=' ),
				'manageEventUrl' => admin_url( 'admin.php?page=fair-events-manage-event' ),
			);

			// Add participants URL if fair-audience plugin is active.
			if ( defined( 'FAIR_AUDIENCE_PLUGIN_DIR' ) ) {
				$calendar_data['participantsUrl'] = admin_url( 'admin.php?page=fair-audience-event-participants&event_id=' );
			}

			wp_localize_script(
				'fair-events-calendar',
				'fairEventsCalendarData',
				$calendar_data
			);

			wp_set_script_translations(
				'fair-events-calendar',
				'fair-events',
				FAIR_EVENTS_PLUGIN_DIR . 'build/languages'
			);

			return;
		}

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

			wp_localize_script(
				'fair-events-sources',
				'fairEventsSourcesData',
				array(
					'icalUrlTemplate' => rest_url( 'fair-events/v1/sources/{slug}/ical' ),
					'jsonUrlTemplate' => rest_url( 'fair-events/v1/sources/{slug}/json' ),
				)
			);

			wp_set_script_translations(
				'fair-events-sources',
				'fair-events',
				FAIR_EVENTS_PLUGIN_DIR . 'build/languages'
			);

			wp_enqueue_style( 'wp-components' );
			return;
		}

		// Migration page
		if ( 'fair_event_page_fair-events-migration' === $hook ) {
			$asset_file = include FAIR_EVENTS_PLUGIN_DIR . 'build/admin/migration/index.asset.php';

			wp_enqueue_script(
				'fair-events-migration',
				FAIR_EVENTS_PLUGIN_URL . 'build/admin/migration/index.js',
				$asset_file['dependencies'],
				$asset_file['version'],
				true
			);

			wp_set_script_translations(
				'fair-events-migration',
				'fair-events',
				FAIR_EVENTS_PLUGIN_DIR . 'build/languages'
			);

			wp_enqueue_style( 'wp-components' );
			return;
		}

		// Source View page (hidden pages use 'admin_page_' prefix).
		if ( 'admin_page_fair-events-source-view' === $hook ) {
			$asset_file = include FAIR_EVENTS_PLUGIN_DIR . 'build/admin/source-view/index.asset.php';

			wp_enqueue_script(
				'fair-events-source-view',
				FAIR_EVENTS_PLUGIN_URL . 'build/admin/source-view/index.js',
				$asset_file['dependencies'],
				$asset_file['version'],
				true
			);

			// Reuse the calendar stylesheet (shared CSS for calendar grid components).
			$calendar_asset = include FAIR_EVENTS_PLUGIN_DIR . 'build/admin/calendar/index.asset.php';
			wp_enqueue_style(
				'fair-events-calendar',
				FAIR_EVENTS_PLUGIN_URL . 'build/admin/calendar/style-index.css',
				array( 'wp-components' ),
				$calendar_asset['version']
			);

			// phpcs:ignore WordPress.Security.NonceVerification.Recommended
			$source_id = isset( $_GET['source_id'] ) ? absint( $_GET['source_id'] ) : 0;

			wp_localize_script(
				'fair-events-source-view',
				'fairEventsSourceViewData',
				array(
					'sourceId'        => $source_id,
					'startOfWeek'     => (int) get_option( 'start_of_week', 1 ),
					'sourcesListUrl'  => admin_url( 'admin.php?page=fair-events-sources' ),
					'icalUrlTemplate' => rest_url( 'fair-events/v1/sources/{slug}/ical' ),
					'jsonUrlTemplate' => rest_url( 'fair-events/v1/sources/{slug}/json' ),
				)
			);

			wp_set_script_translations(
				'fair-events-source-view',
				'fair-events',
				FAIR_EVENTS_PLUGIN_DIR . 'build/languages'
			);

			return;
		}

		// Manage Event page (hidden pages use 'admin_page_' prefix).
		if ( 'admin_page_fair-events-manage-event' === $hook ) {
			wp_enqueue_media();

			$asset_file = include FAIR_EVENTS_PLUGIN_DIR . 'build/admin/manage-event/index.asset.php';

			wp_enqueue_script(
				'fair-events-manage-event',
				FAIR_EVENTS_PLUGIN_URL . 'build/admin/manage-event/index.js',
				$asset_file['dependencies'],
				$asset_file['version'],
				true
			);

			// phpcs:ignore WordPress.Security.NonceVerification.Recommended
			$event_date_id = isset( $_GET['event_date_id'] ) ? absint( $_GET['event_date_id'] ) : 0;

			$enabled_slugs      = \FairEvents\Settings\Settings::get_enabled_post_types();
			$enabled_post_types = array();
			foreach ( $enabled_slugs as $slug ) {
				$post_type_object = get_post_type_object( $slug );
				if ( $post_type_object ) {
					$enabled_post_types[] = array(
						'slug'  => $slug,
						'label' => $post_type_object->labels->singular_name,
					);
				}
			}

			$localized_data = array(
				'eventDateId'      => $event_date_id,
				'calendarUrl'      => admin_url( 'admin.php?page=fair-events-calendar' ),
				'enabledPostTypes' => $enabled_post_types,
			);

			// Add audience URL if fair-audience plugin is active.
			if ( defined( 'FAIR_AUDIENCE_PLUGIN_DIR' ) ) {
				$localized_data['audienceUrl'] = admin_url( 'admin.php?page=fair-audience-event-participants&event_id=' );
			}

			wp_localize_script(
				'fair-events-manage-event',
				'fairEventsManageEventData',
				$localized_data
			);

			wp_set_script_translations(
				'fair-events-manage-event',
				'fair-events',
				FAIR_EVENTS_PLUGIN_DIR . 'build/languages'
			);

			wp_enqueue_style( 'wp-components' );
			return;
		}

		// Venues page
		if ( 'fair_event_page_fair-events-venues' === $hook ) {
			$asset_file = include FAIR_EVENTS_PLUGIN_DIR . 'build/admin/venues/index.asset.php';

			wp_enqueue_script(
				'fair-events-venues',
				FAIR_EVENTS_PLUGIN_URL . 'build/admin/venues/index.js',
				$asset_file['dependencies'],
				$asset_file['version'],
				true
			);

			wp_set_script_translations(
				'fair-events-venues',
				'fair-events',
				FAIR_EVENTS_PLUGIN_DIR . 'build/languages'
			);

			wp_enqueue_style( 'wp-components' );
			return;
		}

		// Only load on Fair Events admin pages.
		if ( 'fair_event_page_fair-events-settings' !== $hook ) {
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

			wp_localize_script(
				'fair-events-settings',
				'fairEventsSettingsData',
				array(
					'eventsApiUrl' => rest_url( 'fair-events/v1/events' ),
				)
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
	 * Render migration page
	 *
	 * @return void
	 */
	public function render_migration_page() {
		?>
		<div id="fair-events-migration-root"></div>
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
	 * Render calendar page
	 *
	 * @return void
	 */
	public function render_calendar_page() {
		?>
		<div id="fair-events-calendar-root"></div>
		<?php
	}

	/**
	 * Render venues page
	 *
	 * @return void
	 */
	public function render_venues_page() {
		?>
		<div id="fair-events-venues-root"></div>
		<?php
	}

	/**
	 * Render source view page
	 *
	 * @return void
	 */
	public function render_source_view_page() {
		?>
		<div id="fair-events-source-view-root"></div>
		<?php
	}

	/**
	 * Render manage event page
	 *
	 * @return void
	 */
	public function render_manage_event_page() {
		$manage_event_page = new ManageEventPage();
		$manage_event_page->render();
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
	 * Reorder admin menu: Calendar first, Settings last
	 *
	 * @return void
	 */
	public function reorder_admin_menu() {
		global $submenu;

		$parent_slug = 'edit.php?post_type=fair_event';

		if ( ! isset( $submenu[ $parent_slug ] ) ) {
			return;
		}

		// Find special items
		$calendar_item = null;
		$calendar_key  = null;
		$settings_item = null;
		$settings_key  = null;
		$upcoming_item = null;
		$upcoming_key  = null;

		foreach ( $submenu[ $parent_slug ] as $key => $item ) {
			if ( isset( $item[2] ) ) {
				if ( 'fair-events-calendar' === $item[2] ) {
					$calendar_item = $item;
					$calendar_key  = $key;
				} elseif ( 'fair-events-settings' === $item[2] ) {
					$settings_item = $item;
					$settings_key  = $key;
				} elseif ( strpos( $item[2], 'upcoming=1' ) !== false ) {
					$upcoming_item = $item;
					$upcoming_key  = $key;
				}
			}
		}

		// Remove items we want to reposition
		if ( null !== $calendar_key ) {
			unset( $submenu[ $parent_slug ][ $calendar_key ] );
		}
		if ( null !== $settings_key ) {
			unset( $submenu[ $parent_slug ][ $settings_key ] );
		}
		if ( null !== $upcoming_key ) {
			unset( $submenu[ $parent_slug ][ $upcoming_key ] );
		}

		// Re-index the remaining items
		$remaining_items = array_values( $submenu[ $parent_slug ] );

		// Build the new menu order
		$new_submenu = array();

		// 1. Calendar first
		if ( $calendar_item ) {
			$new_submenu[] = $calendar_item;
		}

		// 2. Add remaining items, inserting Upcoming after the first item (All Events)
		$position = 0;
		foreach ( $remaining_items as $item ) {
			$new_submenu[] = $item;
			++$position;

			// Insert Upcoming after "All Events" (first item) and "Add New" (second item)
			if ( 2 === $position && $upcoming_item ) {
				$new_submenu[] = $upcoming_item;
			}
		}

		// 3. Settings last
		if ( $settings_item ) {
			$new_submenu[] = $settings_item;
		}

		$submenu[ $parent_slug ] = $new_submenu;
	}

	/**
	 * Filter events to show only upcoming ones via custom table JOIN
	 *
	 * @param \WP_Query $query The query object.
	 * @return void
	 *
	 * phpcs:disable WordPress.DB.DirectDatabaseQuery
	 */
	public function filter_upcoming_events( $query ) {
		// Only on admin, main query, for fair_event post type.
		if ( ! is_admin() || ! $query->is_main_query() || 'fair_event' !== $query->get( 'post_type' ) ) {
			return;
		}

		// Check if upcoming filter is active.
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended
		if ( ! isset( $_GET['upcoming'] ) || '1' !== $_GET['upcoming'] ) {
			return;
		}

		add_filter( 'posts_clauses', array( $this, 'upcoming_events_clauses' ), 10, 2 );
	}

	/**
	 * Modify query clauses for upcoming events filter
	 *
	 * @param array     $clauses Query clauses.
	 * @param \WP_Query $query   The query object.
	 * @return array Modified clauses.
	 *
	 * phpcs:disable WordPress.DB.DirectDatabaseQuery
	 */
	public function upcoming_events_clauses( $clauses, $query ) {
		global $wpdb;

		$table_name  = $wpdb->prefix . 'fair_event_dates';
		$posts_table = $wpdb->prefix . 'fair_event_date_posts';

		$current_datetime = current_time( 'mysql' );

		// JOIN via direct event_id OR junction table.
		$clauses['join'] .= " LEFT JOIN {$table_name} AS fed_upcoming ON ({$wpdb->posts}.ID = fed_upcoming.event_id AND fed_upcoming.occurrence_type IN ('single', 'master'))";
		$clauses['join'] .= " LEFT JOIN {$posts_table} AS fedp_upcoming ON {$wpdb->posts}.ID = fedp_upcoming.post_id";
		$clauses['join'] .= " LEFT JOIN {$table_name} AS fed2_upcoming ON (fedp_upcoming.event_date_id = fed2_upcoming.id AND fed2_upcoming.occurrence_type IN ('single', 'master'))";

		// WHERE: start_datetime >= now (from either join path).
		$clauses['where'] .= $wpdb->prepare(
			' AND COALESCE(fed_upcoming.start_datetime, fed2_upcoming.start_datetime) >= %s',
			$current_datetime
		);

		// ORDER BY start_datetime ASC.
		$clauses['orderby'] = 'COALESCE(fed_upcoming.start_datetime, fed2_upcoming.start_datetime) ASC';

		// Remove this filter after first use.
		remove_filter( 'posts_clauses', array( $this, 'upcoming_events_clauses' ), 10 );

		return $clauses;
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
