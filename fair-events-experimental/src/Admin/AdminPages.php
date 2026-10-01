<?php
/**
 * Admin Pages for Fair Events Experimental
 *
 * Registers the experimental admin pages (compare events, sources, event tools) as
 * submenus under the fair-events-calendar menu. The experimental
 * settings live in an Experimental tab of the fair-events Settings page; the
 * former standalone settings slug only redirects there.
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
		// After Fair Events' own menu reorder (priority 999).
		add_action( 'admin_menu', array( $this, 'place_compare_events_before_sources' ), 1000 );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_admin_scripts' ) );
		add_action( 'fair_events_settings_enqueue_assets', array( $this, 'enqueue_settings_tab_assets' ) );
	}

	/**
	 * Register admin menu pages
	 *
	 * @return void
	 */
	public function register_admin_pages() {
		$parent = $this->get_menu_parent_slug();

		// Former standalone settings page (hidden). Kept only so bookmarks
		// redirect to the Experimental tab of the Fair Events Settings page.
		$settings_hook = add_submenu_page(
			'',
			__( 'Experimental Settings', 'fair-events-experimental' ),
			__( 'Experimental Settings', 'fair-events-experimental' ),
			'manage_options',
			'fair-events-experimental-settings',
			'__return_null'
		);
		add_action( 'load-' . $settings_hook, array( $this, 'redirect_legacy_settings_page' ) );

		// Compare events page. Not part of a bundle: it only reads Fair Events'
		// Statistics, so it is registered whether or not Sources is enabled.
		$this->page_hooks['fair-events-compare-events'] = add_submenu_page(
			$parent,
			__( 'Compare events', 'fair-events-experimental' ),
			__( 'Compare events', 'fair-events-experimental' ),
			'manage_options',
			'fair-events-compare-events',
			array( $this, 'render_compare_events_page' )
		);

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

		// Advanced event pages — `event-tools` bundle (hidden).
		if ( \FairEventsExperimental\Core\Features::is_enabled( 'event-tools' ) ) {
			$this->page_hooks['fair-events-duplicate-event'] = add_submenu_page(
				'',
				__( 'Duplicate Event', 'fair-events-experimental' ),
				__( 'Duplicate Event', 'fair-events-experimental' ),
				'edit_posts',
				'fair-events-duplicate-event',
				array( $this, 'render_duplicate_event_page' )
			);

			$this->set_hidden_page_title( $this->page_hooks['fair-events-duplicate-event'], __( 'Duplicate Event', 'fair-events-experimental' ) );

			$this->page_hooks['fair-events-merge-event'] = add_submenu_page(
				'',
				__( 'Merge Event', 'fair-events-experimental' ),
				__( 'Merge Event', 'fair-events-experimental' ),
				'edit_posts',
				'fair-events-merge-event',
				array( $this, 'render_merge_event_page' )
			);

			$this->set_hidden_page_title( $this->page_hooks['fair-events-merge-event'], __( 'Merge Event', 'fair-events-experimental' ) );
		}
	}

	/**
	 * Keep Compare events immediately before Event Sources in the Events menu.
	 *
	 * Runs after Fair Events' reorder_admin_menu(), which keeps the relative
	 * order of these items but lets other plugins' pages land between them.
	 * Without Sources the page stays where it was registered.
	 *
	 * @return void
	 */
	public function place_compare_events_before_sources() {
		global $submenu;

		$parent = $this->get_menu_parent_slug();
		if ( empty( $submenu[ $parent ] ) ) {
			return;
		}

		$items   = array_values( $submenu[ $parent ] );
		$slugs   = array_column( $items, 2 );
		$compare = array_search( 'fair-events-compare-events', $slugs, true );
		if ( false === $compare || ! in_array( 'fair-events-sources', $slugs, true ) ) {
			return;
		}

		$compare_item = $items[ $compare ];
		unset( $items[ $compare ] );
		$items   = array_values( $items );
		$sources = array_search( 'fair-events-sources', array_column( $items, 2 ), true );
		array_splice( $items, $sources, 0, array( $compare_item ) );

		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- Reordering this WordPress menu requires replacing its submenu array.
		$submenu[ $parent ] = $items;
	}

	/**
	 * Whether Fair Events can serve the Statistics the comparison charts read.
	 *
	 * @return bool
	 */
	private function is_statistics_available() {
		$controller = '\FairEvents\API\EventStatisticsController';

		return method_exists( $controller, 'is_available' ) && $controller::is_available();
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

		// Pages load JS from this plugin's own build directory.
		$exp_url = FAIR_EVENTS_EXPERIMENTAL_PLUGIN_URL;
		$exp_dir = FAIR_EVENTS_EXPERIMENTAL_PLUGIN_DIR;

		switch ( $slug ) {
			case 'fair-events-compare-events':
				$asset_file = include $exp_dir . 'build/admin/compare-events/index.asset.php';
				wp_enqueue_script( 'fair-events-compare-events', $exp_url . 'build/admin/compare-events/index.js', $asset_file['dependencies'], $asset_file['version'], true );
				// Styles imported by the bundle (the comparison charts).
				wp_enqueue_style( 'fair-events-compare-events', $exp_url . 'build/admin/compare-events/index.css', array( 'wp-components' ), $asset_file['version'] );
				wp_localize_script(
					'fair-events-compare-events',
					'fairEventsCompareEventsData',
					array(
						// Without Fair Audience there are no statistics to
						// compare, so the page explains the dependency instead.
						'statisticsAvailable' => $this->is_statistics_available(),
						'manageEventUrl'      => admin_url( 'admin.php?page=fair-events-manage-event' ),
					)
				);
				wp_set_script_translations( 'fair-events-compare-events', 'fair-events-experimental', \FairEventsExperimental\Core\Features::script_translations_path() );
				break;

			case 'fair-events-sources':
				$asset_file = include $exp_dir . 'build/admin/sources/index.asset.php';
				wp_enqueue_script( 'fair-events-sources', $exp_url . 'build/admin/sources/index.js', $asset_file['dependencies'], $asset_file['version'], true );
				wp_localize_script(
					'fair-events-sources',
					'fairEventsSourcesData',
					array(
						'icalUrlTemplate' => rest_url( 'fair-events/v1/sources/{slug}/ical' ),
						'jsonUrlTemplate' => rest_url( 'fair-events/v1/sources/{slug}/json' ),
					)
				);
				wp_set_script_translations( 'fair-events-sources', 'fair-events-experimental', \FairEventsExperimental\Core\Features::script_translations_path() );
				wp_enqueue_style( 'wp-components' );
				break;

			case 'fair-events-source-view':
				$asset_file     = include $exp_dir . 'build/admin/source-view/index.asset.php';
				$calendar_asset = include FAIR_EVENTS_PLUGIN_DIR . 'build/admin/calendar/index.asset.php';
				wp_enqueue_script( 'fair-events-source-view', $exp_url . 'build/admin/source-view/index.js', $asset_file['dependencies'], $asset_file['version'], true );
				wp_enqueue_style( 'fair-events-calendar', FAIR_EVENTS_PLUGIN_URL . 'build/admin/calendar/style-index.css', array( 'wp-components' ), $calendar_asset['version'] );
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
				wp_set_script_translations( 'fair-events-source-view', 'fair-events-experimental', \FairEventsExperimental\Core\Features::script_translations_path() );
				break;

			case 'fair-events-duplicate-event':
				$asset_file = include $exp_dir . 'build/admin/duplicate-event/index.asset.php';
				wp_enqueue_script( 'fair-events-duplicate-event', $exp_url . 'build/admin/duplicate-event/index.js', $asset_file['dependencies'], $asset_file['version'], true );
				// phpcs:ignore WordPress.Security.NonceVerification.Recommended
				$event_date_id = isset( $_GET['event_date_id'] ) ? absint( $_GET['event_date_id'] ) : 0;
				$localized     = array(
					'eventDateId'     => $event_date_id,
					'manageEventUrl'  => admin_url( 'admin.php?page=fair-events-manage-event' ),
					// Mirrors fair-events' own manage-event localization so the
					// wizard's Tickets step can gate itself the same way.
					'enabledFeatures' => apply_filters( 'fair_events_enabled_features_map', \FairEvents\Core\Features::public_map() ),
				);
				if ( defined( 'FAIR_AUDIENCE_PLUGIN_DIR' ) ) {
					$localized['audienceUrl'] = admin_url( 'admin.php?page=fair-audience-event-participants&event_date_id=' );
				}
				wp_localize_script( 'fair-events-duplicate-event', 'fairEventsDuplicateEventData', $localized );

				// `connectorActive` is always present so the ported ticket editor
				// can tell "connector plugin missing" apart from "installed but
				// unconfigured", mirroring fair-events' own manage-event page.
				$connector_active        = class_exists( '\FairPaymentsConnector\Payment\MolliePaymentHandler' );
				$payments_connector_data = array(
					'currency'        => get_option( 'fair_payment_currency', 'EUR' ),
					'connectorActive' => $connector_active,
				);
				if ( $connector_active ) {
					$payments_connector_data['paymentConfigured'] = \FairPaymentsConnector\Payment\MolliePaymentHandler::is_configured();
					$payments_connector_data['settingsUrl']       = admin_url( 'admin.php?page=fair-payments-connector-settings' );
				}
				wp_localize_script( 'fair-events-duplicate-event', 'fairPaymentsConnector', $payments_connector_data );

				// The ported ticket editor reads the site-today default from this
				// global regardless of which page it's mounted on.
				wp_localize_script(
					'fair-events-duplicate-event',
					'fairEventsManageEventData',
					array( 'siteToday' => wp_date( 'Y-m-d' ) )
				);

				wp_set_script_translations( 'fair-events-duplicate-event', 'fair-events-experimental', \FairEventsExperimental\Core\Features::script_translations_path() );
				wp_enqueue_style( 'wp-components' );
				break;

			case 'fair-events-merge-event':
				$asset_file = include $exp_dir . 'build/admin/merge-event/index.asset.php';
				wp_enqueue_script( 'fair-events-merge-event', $exp_url . 'build/admin/merge-event/index.js', $asset_file['dependencies'], $asset_file['version'], true );
				// phpcs:ignore WordPress.Security.NonceVerification.Recommended
				$event_date_id = isset( $_GET['event_date_id'] ) ? absint( $_GET['event_date_id'] ) : 0;
				wp_localize_script(
					'fair-events-merge-event',
					'fairEventsMergeEventData',
					array(
						'eventDateId'    => $event_date_id,
						'manageEventUrl' => admin_url( 'admin.php?page=fair-events-manage-event' ),
					)
				);
				wp_set_script_translations( 'fair-events-merge-event', 'fair-events-experimental', \FairEventsExperimental\Core\Features::script_translations_path() );
				wp_enqueue_style( 'wp-components' );
				break;
		}
	}

	/**
	 * Redirect the former Experimental Settings page to its tab on the
	 * Fair Events Settings page. Temporary (302), so browsers don't cache it
	 * past deactivation or a future URL change.
	 *
	 * @return void
	 */
	public function redirect_legacy_settings_page() {
		wp_safe_redirect( admin_url( 'admin.php?page=fair-events-settings&tab=experimental' ), 302 );
		exit;
	}

	/**
	 * Enqueue the Experimental tab on the fair-events Settings page.
	 *
	 * Declares `fair-events-settings` as a script dependency so the tab's
	 * `addFilter()` call runs before the host bundle mounts.
	 *
	 * @return void
	 */
	public function enqueue_settings_tab_assets() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$asset_file = include FAIR_EVENTS_EXPERIMENTAL_PLUGIN_DIR . 'build/admin/settings/index.asset.php';

		wp_enqueue_script(
			'fair-events-experimental-settings',
			FAIR_EVENTS_EXPERIMENTAL_PLUGIN_URL . 'build/admin/settings/index.js',
			array_merge( $asset_file['dependencies'], array( 'fair-events-settings' ) ),
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

		wp_set_script_translations( 'fair-events-experimental-settings', 'fair-events-experimental', \FairEventsExperimental\Core\Features::script_translations_path() );
	}

	/**
	 * Render compare events page
	 *
	 * @return void
	 */
	public function render_compare_events_page() {
		?>
		<div id="fair-events-compare-events-root"></div>
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
	 * Render duplicate event page
	 *
	 * @return void
	 */
	public function render_duplicate_event_page() {
		?>
		<div id="fair-events-duplicate-event-root"></div>
		<?php
	}

	/**
	 * Render merge event page
	 *
	 * @return void
	 */
	public function render_merge_event_page() {
		?>
		<div id="fair-events-merge-event-root"></div>
		<?php
	}
}
