<?php
/**
 * Admin Pages for Fair Events Experimental
 *
 * Registers the experimental feature admin pages (migration, sources, venues,
 * invitations, copy, settings) as submenus under the fair-events-calendar menu.
 * Page rendering and JS assets are delegated to the fair-events plugin; only
 * the settings page uses assets from this plugin's own build directory.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Admin;

defined( 'WPINC' ) || die;

/**
 * Admin Pages class for registering experimental admin menu pages
 */
class AdminPages {
	/**
	 * Map of page slug => admin page hook name.
	 *
	 * @var array<string,string>
	 */
	private $page_hooks = array();

	/**
	 * Parent menu slug (owned by fair-events).
	 *
	 * @return string
	 */
	private function get_menu_parent_slug() {
		return 'fair-events-calendar';
	}

	/**
	 * Initialize admin pages
	 *
	 * @return void
	 */
	public function init() {
		add_action( 'admin_menu', array( $this, 'register_admin_pages' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_admin_scripts' ) );
	}

	/**
	 * Register admin menu pages
	 *
	 * @return void
	 */
	public function register_admin_pages() {
		$parent = $this->get_menu_parent_slug();

		// Settings page for experimental feature toggles.
		$this->page_hooks['fair-events-experimental-settings'] = add_submenu_page(
			$parent,
			__( 'Experimental Settings', 'fair-events-experimental' ),
			__( 'Experimental', 'fair-events-experimental' ),
			'manage_options',
			'fair-events-experimental-settings',
			array( $this, 'render_settings_page' )
		);

		// Migration pages — `migration` bundle.
		if ( \FairEventsExperimental\Core\Features::is_enabled( 'migration' ) && post_type_exists( 'fair_event' ) ) {
			$this->page_hooks['fair-events-migration'] = add_submenu_page(
				$parent,
				__( 'Migrate Posts to Events', 'fair-events-experimental' ),
				__( 'Migrate Posts', 'fair-events-experimental' ),
				'manage_options',
				'fair-events-migration',
				array( $this, 'render_migration_page' )
			);

			$this->page_hooks['fair-events-migration-summary'] = add_submenu_page(
				$parent,
				__( 'Migration Summary', 'fair-events-experimental' ),
				__( 'Migration Summary', 'fair-events-experimental' ),
				'manage_options',
				'fair-events-migration-summary',
				array( $this, 'render_migration_summary_page' )
			);
		}

		// Event Sources page — `sources` bundle.
		if ( \FairEventsExperimental\Core\Features::is_enabled( 'sources' ) ) {
			$this->page_hooks['fair-events-sources'] = add_submenu_page(
				$parent,
				__( 'Event Sources', 'fair-events-experimental' ),
				__( 'Event Sources', 'fair-events-experimental' ),
				'manage_options',
				'fair-events-sources',
				array( $this, 'render_sources_page' )
			);

			$this->page_hooks['fair-events-source-view'] = add_submenu_page(
				'',
				__( 'View Source', 'fair-events-experimental' ),
				__( 'View Source', 'fair-events-experimental' ),
				'manage_options',
				'fair-events-source-view',
				array( $this, 'render_source_view_page' )
			);

			$this->set_hidden_page_title( $this->page_hooks['fair-events-source-view'], __( 'View Source', 'fair-events-experimental' ) );
		}

		// Venues page — `venues` bundle.
		if ( \FairEventsExperimental\Core\Features::is_enabled( 'venues' ) ) {
			$this->page_hooks['fair-events-venues'] = add_submenu_page(
				$parent,
				__( 'Venues', 'fair-events-experimental' ),
				__( 'Venues', 'fair-events-experimental' ),
				'manage_options',
				'fair-events-venues',
				array( $this, 'render_venues_page' )
			);
		}

		// Manage Invitations page — `ticketing` bundle (hidden).
		if ( \FairEventsExperimental\Core\Features::is_enabled( 'ticketing' ) ) {
			$this->page_hooks['fair-events-manage-invitations'] = add_submenu_page(
				'',
				__( 'Manage Invitations', 'fair-events-experimental' ),
				__( 'Manage Invitations', 'fair-events-experimental' ),
				'manage_options',
				'fair-events-manage-invitations',
				array( $this, 'render_manage_invitations_page' )
			);

			$this->set_hidden_page_title( $this->page_hooks['fair-events-manage-invitations'], __( 'Manage Invitations', 'fair-events-experimental' ) );
		}

		// Copy Event page — `event-tools` bundle (hidden).
		if ( \FairEventsExperimental\Core\Features::is_enabled( 'event-tools' ) ) {
			$this->page_hooks['fair-events-copy'] = add_submenu_page(
				'',
				__( 'Copy Event', 'fair-events-experimental' ),
				__( 'Copy Event', 'fair-events-experimental' ),
				'edit_posts',
				'fair-events-copy',
				array( $this, 'render_copy_event_page' )
			);

			$this->set_hidden_page_title( $this->page_hooks['fair-events-copy'], __( 'Copy Event', 'fair-events-experimental' ) );

			add_action( 'load-' . $this->page_hooks['fair-events-copy'], array( $this, 'handle_copy_event_submission' ) );

			add_action( 'admin_bar_menu', array( $this, 'add_copy_button_to_admin_bar' ), 100 );
		}
	}

	/**
	 * Set the page title for a hidden admin page.
	 *
	 * @param string $hookname  The page hook name returned by add_submenu_page().
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
		$slug = array_search( $hook, $this->page_hooks, true );
		if ( false === $slug ) {
			return;
		}

		// Settings page uses this plugin's own build.
		if ( 'fair-events-experimental-settings' === $slug ) {
			$asset_file = include FAIR_EVENTS_EXPERIMENTAL_PLUGIN_DIR . 'build/admin/settings/index.asset.php';

			wp_enqueue_script(
				'fair-events-experimental-settings',
				FAIR_EVENTS_EXPERIMENTAL_PLUGIN_URL . 'build/admin/settings/index.js',
				$asset_file['dependencies'],
				$asset_file['version'],
				true
			);

			wp_localize_script(
				'fair-events-experimental-settings',
				'fairEventsExperimentalSettingsData',
				array(
					'features' => \FairEventsExperimental\Core\Features::all(),
				)
			);

			wp_set_script_translations( 'fair-events-experimental-settings', 'fair-events-experimental' );
			wp_enqueue_style( 'wp-components' );
			return;
		}

		// All other pages load JS from the fair-events build directory.
		$fe_url = FAIR_EVENTS_PLUGIN_URL;
		$fe_dir = FAIR_EVENTS_PLUGIN_DIR;

		switch ( $slug ) {
			case 'fair-events-migration':
				$asset_file = include $fe_dir . 'build/admin/migration/index.asset.php';
				wp_enqueue_script( 'fair-events-migration', $fe_url . 'build/admin/migration/index.js', $asset_file['dependencies'], $asset_file['version'], true );
				wp_set_script_translations( 'fair-events-migration', 'fair-events', \FairEvents\Core\Features::script_translations_path() );
				wp_enqueue_style( 'wp-components' );
				break;

			case 'fair-events-migration-summary':
				$asset_file = include $fe_dir . 'build/admin/migration-summary/index.asset.php';
				wp_enqueue_script( 'fair-events-migration-summary', $fe_url . 'build/admin/migration-summary/index.js', $asset_file['dependencies'], $asset_file['version'], true );
				wp_set_script_translations( 'fair-events-migration-summary', 'fair-events', \FairEvents\Core\Features::script_translations_path() );
				wp_enqueue_style( 'wp-components' );
				break;

			case 'fair-events-sources':
				$asset_file = include $fe_dir . 'build/admin/sources/index.asset.php';
				wp_enqueue_script( 'fair-events-sources', $fe_url . 'build/admin/sources/index.js', $asset_file['dependencies'], $asset_file['version'], true );
				wp_localize_script(
					'fair-events-sources',
					'fairEventsSourcesData',
					array(
						'icalUrlTemplate' => rest_url( 'fair-events/v1/sources/{slug}/ical' ),
						'jsonUrlTemplate' => rest_url( 'fair-events/v1/sources/{slug}/json' ),
					)
				);
				wp_set_script_translations( 'fair-events-sources', 'fair-events', \FairEvents\Core\Features::script_translations_path() );
				wp_enqueue_style( 'wp-components' );
				break;

			case 'fair-events-source-view':
				$asset_file     = include $fe_dir . 'build/admin/source-view/index.asset.php';
				$calendar_asset = include $fe_dir . 'build/admin/calendar/index.asset.php';
				wp_enqueue_script( 'fair-events-source-view', $fe_url . 'build/admin/source-view/index.js', $asset_file['dependencies'], $asset_file['version'], true );
				wp_enqueue_style( 'fair-events-calendar', $fe_url . 'build/admin/calendar/style-index.css', array( 'wp-components' ), $calendar_asset['version'] );
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
				wp_set_script_translations( 'fair-events-source-view', 'fair-events', \FairEvents\Core\Features::script_translations_path() );
				break;

			case 'fair-events-venues':
				$asset_file = include $fe_dir . 'build/admin/venues/index.asset.php';
				wp_enqueue_script( 'fair-events-venues', $fe_url . 'build/admin/venues/index.js', $asset_file['dependencies'], $asset_file['version'], true );
				wp_set_script_translations( 'fair-events-venues', 'fair-events', \FairEvents\Core\Features::script_translations_path() );
				wp_enqueue_style( 'wp-components' );
				break;

			case 'fair-events-manage-invitations':
				$asset_file = include $fe_dir . 'build/admin/manage-invitations/index.asset.php';
				wp_enqueue_script( 'fair-events-manage-invitations', $fe_url . 'build/admin/manage-invitations/index.js', $asset_file['dependencies'], $asset_file['version'], true );
				// phpcs:ignore WordPress.Security.NonceVerification.Recommended
				$event_date_id   = isset( $_GET['event_date_id'] ) ? absint( $_GET['event_date_id'] ) : 0;
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
				wp_set_script_translations( 'fair-events-manage-invitations', 'fair-events', \FairEvents\Core\Features::script_translations_path() );
				wp_enqueue_style( 'wp-components' );
				break;
		}
	}

	/**
	 * Render experimental settings page
	 *
	 * @return void
	 */
	public function render_settings_page() {
		?>
		<div id="fair-events-experimental-settings-root"></div>
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
	 * Render manage invitations page
	 *
	 * @return void
	 */
	public function render_manage_invitations_page() {
		$manage_invitations_page = new \FairEvents\Admin\ManageInvitationsPage();
		$manage_invitations_page->render();
	}

	/**
	 * Handle copy event form submission
	 *
	 * @return void
	 */
	public function handle_copy_event_submission() {
		// phpcs:ignore WordPress.Security.NonceVerification.Missing
		if ( ! isset( $_POST['copy_event_submit'] ) ) {
			return;
		}

		$copy_page = new \FairEvents\Admin\CopyEventPage();
		$copy_page->handle_submission();
	}

	/**
	 * Render copy event page
	 *
	 * @return void
	 */
	public function render_copy_event_page() {
		$copy_page = new \FairEvents\Admin\CopyEventPage();
		$copy_page->render();
	}

	/**
	 * Add Copy button to admin bar on event edit pages
	 *
	 * @param \WP_Admin_Bar $wp_admin_bar The admin bar object.
	 * @return void
	 */
	public function add_copy_button_to_admin_bar( $wp_admin_bar ) {
		if ( ! is_admin() ) {
			return;
		}

		if ( ! post_type_exists( 'fair_event' ) ) {
			return;
		}

		$screen = get_current_screen();
		if ( ! $screen || 'fair_event' !== $screen->post_type || 'post' !== $screen->base ) {
			return;
		}

		// phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$post_id = isset( $_GET['post'] ) ? absint( $_GET['post'] ) : 0;
		if ( ! $post_id ) {
			return;
		}

		$post = get_post( $post_id );
		if ( ! $post || 'fair_event' !== $post->post_type ) {
			return;
		}

		if ( ! current_user_can( 'edit_posts' ) ) {
			return;
		}

		$copy_url = add_query_arg(
			array(
				'page'     => 'fair-events-copy',
				'event_id' => $post_id,
				'_wpnonce' => wp_create_nonce( 'copy_fair_event_' . $post_id ),
			),
			admin_url( 'admin.php' )
		);

		$wp_admin_bar->add_node(
			array(
				'id'    => 'copy-event',
				'title' => __( 'Copy', 'fair-events-experimental' ),
				'href'  => $copy_url,
				'meta'  => array(
					'title' => __( 'Copy this event', 'fair-events-experimental' ),
				),
			)
		);
	}
}
