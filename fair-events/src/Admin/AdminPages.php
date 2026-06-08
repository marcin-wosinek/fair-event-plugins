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
	 * Map of page slug => admin page hook name, captured at registration.
	 *
	 * WordPress derives admin page hook names from the parent slug, so the
	 * enqueue logic must look them up here rather than hardcoding strings like
	 * `fair_event_page_*` (which break the moment the parent slug changes).
	 *
	 * @var array<string,string>
	 */
	private $page_hooks = array();

	/**
	 * The top-level menu slug all Fair Events pages parent under.
	 *
	 * Single source of truth shared by the submenu registrations, the menu
	 * reorder logic, and internal links — independent of the `fair_event` CPT.
	 *
	 * @return string
	 */
	private function get_menu_parent_slug() {
		return 'fair-events-calendar';
	}

	/**
	 * URL for creating a new event.
	 *
	 * Points at the `fair_event` CPT when it is registered (today's default),
	 * otherwise the first enabled post type's add-new screen.
	 *
	 * @return string
	 */
	private function get_new_event_url() {
		if ( post_type_exists( 'fair_event' ) ) {
			return admin_url( 'post-new.php?post_type=fair_event' );
		}

		foreach ( \FairEvents\Settings\Settings::get_enabled_post_types() as $slug ) {
			if ( post_type_exists( $slug ) ) {
				return admin_url( 'post-new.php?post_type=' . $slug );
			}
		}

		return admin_url( 'post-new.php' );
	}

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
		add_filter( 'views_edit-fair_event', array( $this, 'add_upcoming_view_link' ) );
	}

	/**
	 * Register admin menu pages
	 *
	 * @return void
	 */
	public function register_admin_pages() {
		$parent = $this->get_menu_parent_slug();

		// Self-owned top-level menu, independent of the fair_event CPT. The
		// landing page is Calendar (works with or without the CPT). add_menu_page
		// auto-creates a first submenu duplicating the parent slug, labelled with
		// the menu title; reorder_admin_menu() relabels it to "Calendar".
		$this->page_hooks['fair-events-calendar'] = add_menu_page(
			__( 'Events Calendar', 'fair-events' ),
			// Not translatable - "Fair Events" is the brand name.
			'Fair Events',
			'edit_posts',
			$parent,
			array( $this, 'render_calendar_page' ),
			'dashicons-calendar-alt',
			'20.1'
		);

		// Calendar landing submenu. Registering a submenu whose slug matches the
		// parent gives the first row a proper "Calendar" label (the add_menu_page
		// entry above is otherwise labelled with the brand name) without creating
		// a second top-level entry. Not captured in $page_hooks: the active hook
		// for this page is the top-level toplevel_page_* from add_menu_page().
		add_submenu_page(
			$parent,
			__( 'Events Calendar', 'fair-events' ),
			__( 'Calendar', 'fair-events' ),
			'edit_posts',
			'fair-events-calendar',
			array( $this, 'render_calendar_page' )
		);

		// All Events page
		$this->page_hooks['fair-events-all-events'] = add_submenu_page(
			$parent,
			__( 'All Events', 'fair-events' ),
			__( 'All Events', 'fair-events' ),
			'edit_posts',
			'fair-events-all-events',
			array( $this, 'render_all_events_page' )
		);

		// Settings page
		$this->page_hooks['fair-events-settings'] = add_submenu_page(
			$parent,
			__( 'Fair Events Settings', 'fair-events' ),
			__( 'Settings', 'fair-events' ),
			'manage_options',
			'fair-events-settings',
			array( $this, 'render_settings_page' )
		);

		// Migration pages only make sense when the CPT exists (migration
		// targets it) AND the `migration` feature bundle is enabled.
		if ( \FairEvents\Core\Features::is_enabled( 'migration' ) && post_type_exists( 'fair_event' ) ) {
			// Migration page
			$this->page_hooks['fair-events-migration'] = add_submenu_page(
				$parent,
				__( 'Migrate Posts to Events', 'fair-events' ),
				__( 'Migrate Posts', 'fair-events' ),
				'manage_options',
				'fair-events-migration',
				array( $this, 'render_migration_page' )
			);

			// Migration Summary page
			$this->page_hooks['fair-events-migration-summary'] = add_submenu_page(
				$parent,
				__( 'Migration Summary', 'fair-events' ),
				__( 'Migration Summary', 'fair-events' ),
				'manage_options',
				'fair-events-migration-summary',
				array( $this, 'render_migration_summary_page' )
			);
		}

		// Event Sources page — `sources` bundle.
		if ( \FairEvents\Core\Features::is_enabled( 'sources' ) ) {
			$this->page_hooks['fair-events-sources'] = add_submenu_page(
				$parent,
				__( 'Event Sources', 'fair-events' ),
				__( 'Event Sources', 'fair-events' ),
				'manage_options',
				'fair-events-sources',
				array( $this, 'render_sources_page' )
			);

			// Source View page (hidden from menu, accessed via sources list).
			$this->page_hooks['fair-events-source-view'] = add_submenu_page(
				'',
				__( 'View Source', 'fair-events' ),
				__( 'View Source', 'fair-events' ),
				'manage_options',
				'fair-events-source-view',
				array( $this, 'render_source_view_page' )
			);

			$this->set_hidden_page_title( $this->page_hooks['fair-events-source-view'], __( 'View Source', 'fair-events' ) );
		}

		// Venues page — `venues` bundle.
		if ( \FairEvents\Core\Features::is_enabled( 'venues' ) ) {
			$this->page_hooks['fair-events-venues'] = add_submenu_page(
				$parent,
				__( 'Venues', 'fair-events' ),
				__( 'Venues', 'fair-events' ),
				'manage_options',
				'fair-events-venues',
				array( $this, 'render_venues_page' )
			);
		}

		// Manage Event page (hidden from menu, accessed via calendar)
		$this->page_hooks['fair-events-manage-event'] = add_submenu_page(
			'', // Hidden from menu (empty string instead of null for PHP 8.1+ compatibility)
			__( 'Manage Event', 'fair-events' ),
			__( 'Manage Event', 'fair-events' ),
			'edit_posts',
			'fair-events-manage-event',
			array( $this, 'render_manage_event_page' )
		);

		// Manage Invitations page — `ticketing` bundle (hidden, linked from
		// the tickets tab).
		if ( \FairEvents\Core\Features::is_enabled( 'ticketing' ) ) {
			$this->page_hooks['fair-events-manage-invitations'] = add_submenu_page(
				'',
				__( 'Manage Invitations', 'fair-events' ),
				__( 'Manage Invitations', 'fair-events' ),
				'manage_options',
				'fair-events-manage-invitations',
				array( $this, 'render_manage_invitations_page' )
			);

			$this->set_hidden_page_title( $this->page_hooks['fair-events-manage-invitations'], __( 'Manage Invitations', 'fair-events' ) );
		}

		// Copy Event page — `event-tools` bundle (hidden, linked from row
		// action / admin bar).
		if ( \FairEvents\Core\Features::is_enabled( 'event-tools' ) ) {
			$this->page_hooks['fair-events-copy'] = add_submenu_page(
				'',
				__( 'Copy Event', 'fair-events' ),
				__( 'Copy Event', 'fair-events' ),
				'edit_posts',
				'fair-events-copy',
				array( $this, 'render_copy_event_page' )
			);

			$this->set_hidden_page_title( $this->page_hooks['fair-events-copy'], __( 'Copy Event', 'fair-events' ) );

			// Handle copy event form submission before page render.
			add_action( 'load-' . $this->page_hooks['fair-events-copy'], array( $this, 'handle_copy_event_submission' ) );
		}

		// Manage Event hidden-page title (always on; the page itself is core).
		$this->set_hidden_page_title( $this->page_hooks['fair-events-manage-event'], __( 'Manage Event', 'fair-events' ) );
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
		// Resolve the current page to our slug via the captured hook map, so
		// enqueuing is immune to the parent-derived hook prefix (which differs
		// between CPT-on and CPT-off). Bail on any non-Fair-Events page.
		$slug = array_search( $hook, $this->page_hooks, true );
		if ( false === $slug ) {
			return;
		}

		// Calendar page
		if ( 'fair-events-calendar' === $slug ) {
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
				'newEventUrl'    => $this->get_new_event_url(),
				'editEventUrl'   => admin_url( 'post.php?action=edit&post=' ),
				'manageEventUrl' => admin_url( 'admin.php?page=fair-events-manage-event' ),
			);

			// Add participants URL if fair-audience plugin is active.
			if ( defined( 'FAIR_AUDIENCE_PLUGIN_DIR' ) ) {
				$calendar_data['participantsUrl'] = admin_url( 'admin.php?page=fair-audience-event-participants&event_date_id=' );
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

		// All Events page
		if ( 'fair-events-all-events' === $slug ) {
			$asset_file = include FAIR_EVENTS_PLUGIN_DIR . 'build/admin/all-events/index.asset.php';

			wp_enqueue_script(
				'fair-events-all-events',
				FAIR_EVENTS_PLUGIN_URL . 'build/admin/all-events/index.js',
				$asset_file['dependencies'],
				$asset_file['version'],
				true
			);

			wp_localize_script(
				'fair-events-all-events',
				'fairEventsAllEventsData',
				array(
					'manageEventUrl' => admin_url( 'admin.php?page=fair-events-manage-event' ),
				)
			);

			wp_set_script_translations(
				'fair-events-all-events',
				'fair-events',
				FAIR_EVENTS_PLUGIN_DIR . 'build/languages'
			);

			wp_enqueue_style( 'wp-components' );
			return;
		}

		// Event Sources page
		if ( 'fair-events-sources' === $slug ) {
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
		if ( 'fair-events-migration' === $slug ) {
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

		// Migration Summary page
		if ( 'fair-events-migration-summary' === $slug ) {
			$asset_file = include FAIR_EVENTS_PLUGIN_DIR . 'build/admin/migration-summary/index.asset.php';

			wp_enqueue_script(
				'fair-events-migration-summary',
				FAIR_EVENTS_PLUGIN_URL . 'build/admin/migration-summary/index.js',
				$asset_file['dependencies'],
				$asset_file['version'],
				true
			);

			wp_set_script_translations(
				'fair-events-migration-summary',
				'fair-events',
				FAIR_EVENTS_PLUGIN_DIR . 'build/languages'
			);

			wp_enqueue_style( 'wp-components' );
			return;
		}

		// Source View page
		if ( 'fair-events-source-view' === $slug ) {
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

		// Manage Invitations page
		if ( 'fair-events-manage-invitations' === $slug ) {
			$asset_file = include FAIR_EVENTS_PLUGIN_DIR . 'build/admin/manage-invitations/index.asset.php';

			wp_enqueue_script(
				'fair-events-manage-invitations',
				FAIR_EVENTS_PLUGIN_URL . 'build/admin/manage-invitations/index.js',
				$asset_file['dependencies'],
				$asset_file['version'],
				true
			);

			// phpcs:ignore WordPress.Security.NonceVerification.Recommended
			$event_date_id = isset( $_GET['event_date_id'] ) ? absint( $_GET['event_date_id'] ) : 0;

			$signup_page_url = '';
			if ( $event_date_id ) {
				$event_date = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
				if ( $event_date && $event_date->event_id ) {
					$signup_page_url = get_permalink( $event_date->event_id );
				}
			}

			wp_localize_script(
				'fair-events-manage-invitations',
				'fairEventsManageInvitationsData',
				array(
					'eventDateId'    => $event_date_id,
					'manageEventUrl' => admin_url( 'admin.php?page=fair-events-manage-event' ),
					'signupPageUrl'  => $signup_page_url,
				)
			);

			wp_set_script_translations(
				'fair-events-manage-invitations',
				'fair-events',
				FAIR_EVENTS_PLUGIN_DIR . 'build/languages'
			);

			wp_enqueue_style( 'wp-components' );
			return;
		}

		// Manage Event page
		if ( 'fair-events-manage-event' === $slug ) {
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
				'manageEventUrl'   => admin_url( 'admin.php?page=fair-events-manage-event' ),
				'enabledPostTypes' => $enabled_post_types,
				// Resolved feature map — React reads this to hide tabs whose
				// bundle is off (mirroring the existing audienceUrl /
				// paymentEntriesUrl conditionals).
				'enabledFeatures'  => \FairEvents\Core\Features::public_map(),
			);

			// Audience-dependent URLs require both the sibling plugin AND the
			// ticketing/invitations bundle (manage-invitations page lives there).
			if ( defined( 'FAIR_AUDIENCE_PLUGIN_DIR' ) ) {
				$localized_data['audienceUrl']         = admin_url( 'admin.php?page=fair-audience-event-participants&event_date_id=' );
				$localized_data['groupPricingEnabled'] = \FairEvents\Core\Features::is_enabled( 'ticketing' );
				if ( \FairEvents\Core\Features::is_enabled( 'ticketing' ) ) {
					$localized_data['manageInvitationsUrl'] = admin_url( 'admin.php?page=fair-events-manage-invitations&event_date_id=' );
				}
			}

			// Add payment entries URL if fair-payment plugin is active.
			if ( class_exists( 'FairPayment\Core\Plugin' ) ) {
				$localized_data['paymentEntriesUrl'] = admin_url( 'admin.php?page=fair-payment-entries' );
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
		if ( 'fair-events-venues' === $slug ) {
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

		// Settings page (the only remaining slug at this point).
		if ( 'fair-events-settings' !== $slug ) {
			return;
		}

		$asset_file = include FAIR_EVENTS_PLUGIN_DIR . 'build/admin/settings/index.asset.php';

		if ( 'fair-events-settings' === $slug ) {
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
					// Feature registry (labels/descriptions/forced state) for the
					// Features tab; resolved enabled state comes via the stored
					// option once toggles are saved, but the registry itself is
					// PHP-owned.
					'features'     => \FairEvents\Core\Features::all(),
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
	 * Render migration summary page
	 *
	 * @return void
	 */
	public function render_migration_summary_page() {
		?>
		<div id="fair-events-migration-summary-root"></div>
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
	 * Render all events page
	 *
	 * @return void
	 */
	public function render_all_events_page() {
		?>
		<div id="fair-events-all-events-root"></div>
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
	 * Render manage invitations page
	 *
	 * @return void
	 */
	public function render_manage_invitations_page() {
		$manage_invitations_page = new ManageInvitationsPage();
		$manage_invitations_page->render();
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

		$parent_slug = $this->get_menu_parent_slug();

		if ( ! isset( $submenu[ $parent_slug ] ) ) {
			return;
		}

		// Find special items
		$calendar_item   = null;
		$calendar_key    = null;
		$all_events_item = null;
		$all_events_key  = null;
		$settings_item   = null;
		$settings_key    = null;

		foreach ( $submenu[ $parent_slug ] as $key => $item ) {
			if ( isset( $item[2] ) ) {
				if ( 'fair-events-calendar' === $item[2] ) {
					$calendar_item = $item;
					$calendar_key  = $key;
				} elseif ( 'fair-events-all-events' === $item[2] ) {
					$all_events_item = $item;
					$all_events_key  = $key;
				} elseif ( 'fair-events-settings' === $item[2] ) {
					$settings_item = $item;
					$settings_key  = $key;
				}
			}
		}

		// Remove items we want to reposition
		if ( null !== $calendar_key ) {
			unset( $submenu[ $parent_slug ][ $calendar_key ] );
		}
		if ( null !== $all_events_key ) {
			unset( $submenu[ $parent_slug ][ $all_events_key ] );
		}
		if ( null !== $settings_key ) {
			unset( $submenu[ $parent_slug ][ $settings_key ] );
		}

		// Re-index the remaining items
		$remaining_items = array_values( $submenu[ $parent_slug ] );

		// Build the new menu order
		$new_submenu = array();

		// 1. Calendar first
		if ( $calendar_item ) {
			$new_submenu[] = $calendar_item;
		}

		// 2. All Events right after Calendar
		if ( $all_events_item ) {
			$new_submenu[] = $all_events_item;
		}

		// 3. Add remaining items
		foreach ( $remaining_items as $item ) {
			$new_submenu[] = $item;
		}

		// 4. Settings last
		if ( $settings_item ) {
			$new_submenu[] = $settings_item;
		}

		$submenu[ $parent_slug ] = $new_submenu;
	}

	/**
	 * Add "Upcoming" link to the post list views bar
	 *
	 * @param array $views Existing views.
	 * @return array Modified views.
	 */
	public function add_upcoming_view_link( $views ) {
		$url = admin_url( 'edit.php?post_type=fair_event&upcoming=1' );

		// phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$is_current = isset( $_GET['upcoming'] ) && '1' === $_GET['upcoming'];
		$class      = $is_current ? 'current' : '';

		$views['upcoming'] = sprintf(
			'<a href="%s" class="%s">%s</a>',
			esc_url( $url ),
			esc_attr( $class ),
			esc_html__( 'Upcoming', 'fair-events' )
		);

		return $views;
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

		// The Copy flow lives in the `event-tools` bundle — without it
		// enabled the target admin page is not registered.
		if ( ! \FairEvents\Core\Features::is_enabled( 'event-tools' ) ) {
			return;
		}

		// Copy targets the fair_event CPT; nothing to copy when it's not registered.
		if ( ! post_type_exists( 'fair_event' ) ) {
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
