<?php
/**
 * Plugin core class for Fair Events Experimental
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Core;

defined( 'WPINC' ) || die;

/**
 * Main plugin class implementing singleton pattern
 */
class Plugin {
	/**
	 * Single instance of the plugin
	 *
	 * @var Plugin|null
	 */
	private static $instance = null;

	/**
	 * Get singleton instance of the plugin
	 *
	 * @return Plugin Plugin instance
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Initialize the plugin
	 *
	 * @return void
	 */
	public function init() {
		// This companion is never distributed on WordPress.org, so it always
		// bundles its own translation files rather than waiting on a language
		// pack that will never exist.
		add_action(
			'init',
			function () {
				load_plugin_textdomain( 'fair-events-experimental', false, 'fair-events-experimental/languages' );
			}
		);

		$this->load_admin();
		$this->load_settings();
		$this->load_rest_api();
		$this->load_meta_conversions();

		// Registered with every bundle, so the Meta credential stays
		// manageable in Connectors while delivery is off or unavailable.
		\FairEventsExperimental\Meta\Connector::init();

		// Merge experimental feature states into the manage-event enabledFeatures map.
		// Core owns `ticketing` (base ticket configuration); this plugin's own
		// `ticketing` setting only controls its extensions, published under a
		// key of their own so it can never overwrite core's decision.
		add_filter(
			'fair_events_enabled_features_map',
			function ( $map ) {
				foreach ( array_keys( Features::registry() ) as $key ) {
					if ( 'ticketing' === $key ) {
						continue;
					}
					$map[ $key ] = Features::is_enabled( $key );
				}
				$map['ticketingExtensions'] = self::ticketing_extensions_available();
				// Not a bundle of its own: Prices offers "Workshop schedule"
				// whenever this plugin can show the tab it enables.
				$map['schedule'] = self::schedule_available();
				return $map;
			}
		);
	}

	/**
	 * Load and initialize admin pages
	 *
	 * @return void
	 */
	private function load_admin() {
		if ( is_admin() ) {
			$admin = new \FairEventsExperimental\Admin\AdminPages();
			$admin->init();

			// Keep the independent Schedule extension available.
			if ( self::schedule_available() ) {
				add_action( 'fair_events_manage_event_enqueue_assets', array( $this, 'enqueue_manage_event_schedule_assets' ) );
			}
		}
	}

	/**
	 * Whether the ticketing extensions (group pricing and group permission
	 * rules) are available.
	 *
	 * They build on base ticketing, so core Fair Events' `ticketing` feature
	 * must be on as well as this plugin's own `ticketing` setting, and the
	 * groups they target come from Fair Audience. Turning either setting off
	 * only hides the extensions; stored rules are kept. See
	 * docs/ticketing-availability.md.
	 *
	 * @return bool
	 */
	public static function ticketing_extensions_available() {
		return Features::is_enabled( 'ticketing' )
			&& class_exists( \FairEvents\Core\Features::class )
			&& \FairEvents\Core\Features::is_enabled( 'ticketing' )
			&& defined( 'FAIR_AUDIENCE_PLUGIN_DIR' );
	}

	/**
	 * Whether the active Fair Events stores and serves event schedules.
	 *
	 * @return bool
	 */
	private static function schedule_available() {
		return class_exists( \FairEvents\API\EventScheduleController::class );
	}

	/**
	 * Enqueue the Schedule tab on the fair-events manage-event page.
	 *
	 * Declares `fair-events-manage-event` as a script dependency so its
	 * `addFilter()` call runs before the host bundle's `domReady()` mount.
	 *
	 * @return void
	 */
	public function enqueue_manage_event_schedule_assets() {
		$asset_file = include FAIR_EVENTS_EXPERIMENTAL_PLUGIN_DIR . 'build/admin/manage-event-schedule/index.asset.php';

		wp_enqueue_script(
			'fair-events-experimental-manage-event-schedule',
			FAIR_EVENTS_EXPERIMENTAL_PLUGIN_URL . 'build/admin/manage-event-schedule/index.js',
			array_merge( $asset_file['dependencies'], array( 'fair-events-manage-event' ) ),
			$asset_file['version'],
			true
		);

		wp_enqueue_style(
			'fair-events-experimental-manage-event-schedule',
			FAIR_EVENTS_EXPERIMENTAL_PLUGIN_URL . 'build/admin/manage-event-schedule/index.css',
			array( 'wp-components' ),
			$asset_file['version']
		);

		wp_set_script_translations( 'fair-events-experimental-manage-event-schedule', 'fair-events-experimental', Features::script_translations_path() );
	}

	/**
	 * Load and initialize settings
	 *
	 * @return void
	 */
	private function load_settings() {
		$settings = new \FairEventsExperimental\Settings\Settings();
		$settings->init();
	}

	/**
	 * Load and initialize REST API endpoints
	 *
	 * @return void
	 */
	private function load_rest_api() {
		if ( Features::is_enabled( 'sources' ) ) {
			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairEventsExperimental\API\EventSourceController();
					$controller->register_routes();
				}
			);

			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairEventsExperimental\API\EventProposalController();
					$controller->register_routes();
				}
			);
		}

		if ( self::ticketing_extensions_available() ) {
			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairEventsExperimental\API\GroupPricingRulesController();
					$controller->register_routes();
				}
			);

			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairEventsExperimental\API\GroupPermissionRulesController();
					$controller->register_routes();
				}
			);
		}
	}

	/** Load the opt-in Meta integration when its connector dependency exists. */
	private function load_meta_conversions() {
		if ( ! Features::is_enabled( 'meta-conversions' ) || ! class_exists( \FairPaymentsConnector\Models\Transaction::class ) ) {
			return;
		}

		if ( \FairEventsExperimental\Meta\Outbox::DB_VERSION !== (string) get_option( 'fair_events_experimental_meta_db_version', '' ) ) {
			\FairEventsExperimental\Meta\Outbox::install();
		}
		$service = new \FairEventsExperimental\Meta\Conversions();
		$service->init();
		add_action(
			'rest_api_init',
			static function () {
				( new \FairEventsExperimental\API\MetaConversionsController() )->register_routes();
				( new \FairEventsExperimental\API\MetaEngagementController() )->register_routes();
			}
		);
		add_action(
			'wp_enqueue_scripts',
			static function () {
				if ( is_singular() && has_block( 'fair-events/event-signup', get_queried_object() ) ) {
					$asset = include FAIR_EVENTS_EXPERIMENTAL_PLUGIN_DIR . 'build/frontend/meta-attribution.asset.php';
					wp_enqueue_script( 'fair-events-experimental-meta-attribution', FAIR_EVENTS_EXPERIMENTAL_PLUGIN_URL . 'build/frontend/meta-attribution.js', $asset['dependencies'], $asset['version'], true );
				}
			}
		);
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue_meta_engagement' ) );
		if ( ! wp_next_scheduled( \FairEventsExperimental\Meta\Conversions::CLEANUP_HOOK ) ) {
			wp_schedule_event( time() + DAY_IN_SECONDS, 'daily', \FairEventsExperimental\Meta\Conversions::CLEANUP_HOOK );
		}
	}

	/**
	 * Enqueue button-click capture on a public event page, bootstrapped with
	 * the page's event and the occurrence it shows. Nothing loads until Meta
	 * credentials are configured.
	 *
	 * @return void
	 */
	public function enqueue_meta_engagement() {
		if ( ! is_singular() || ! \FairEventsExperimental\Meta\Conversions::configured() ) {
			return;
		}
		$context = \FairEventsExperimental\Meta\Engagement::page_context( get_queried_object_id() );
		if ( ! $context ) {
			return;
		}
		$asset = include FAIR_EVENTS_EXPERIMENTAL_PLUGIN_DIR . 'build/frontend/meta-engagement.asset.php';
		wp_enqueue_script(
			'fair-events-experimental-meta-engagement',
			FAIR_EVENTS_EXPERIMENTAL_PLUGIN_URL . 'build/frontend/meta-engagement.js',
			$asset['dependencies'],
			$asset['version'],
			array(
				'in_footer' => true,
				'strategy'  => 'defer',
			)
		);
		wp_add_inline_script(
			'fair-events-experimental-meta-engagement',
			'window.fairEventsMetaEngagement = ' . wp_json_encode( $context ) . ';',
			'before'
		);
	}

	/**
	 * Private constructor to prevent instantiation
	 */
	private function __construct() {
		// Prevent instantiation.
	}

	/**
	 * Prevent cloning
	 *
	 * @return void
	 */
	private function __clone() {
		// Prevent cloning.
	}

	/**
	 * Prevent unserialization
	 *
	 * @return void
	 */
	public function __wakeup() {
		// Prevent unserialization.
	}
}
