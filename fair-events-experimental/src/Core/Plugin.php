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
		$this->load_admin();
		$this->load_settings();
		$this->load_rest_api();
		$this->load_frontend();

		// Merge experimental feature states into the manage-event enabledFeatures map
		// so the React UI can show galleries/ticketing/venues tabs when active.
		add_filter(
			'fair_events_enabled_features_map',
			function ( $map ) {
				foreach ( array_keys( Features::registry() ) as $key ) {
					$map[ $key ] = Features::is_enabled( $key );
				}
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

			if ( Features::is_enabled( 'galleries' ) ) {
				\FairEvents\Admin\MediaLibraryHooks::init();
				\FairEvents\Admin\MediaBatchActions::init();
			}
		}
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
					$controller = new \FairEvents\API\EventSourceController();
					$controller->register_routes();
				}
			);

			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairEvents\API\EventProposalController();
					$controller->register_routes();
				}
			);

			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairEvents\API\WeeklyEventsController();
					$controller->register_routes();
				}
			);
		}

		if ( Features::is_enabled( 'galleries' ) ) {
			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairEvents\API\EventGalleryEndpoint();
					$controller->register_routes();
				}
			);

			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairEvents\API\PhotoLikesController();
					$controller->register_routes();
				}
			);

			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairEvents\API\PhotoDownloadController();
					$controller->register_routes();
				}
			);
		}

		if ( Features::is_enabled( 'migration' ) ) {
			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairEvents\API\MigrationController();
					$controller->register_routes();
				}
			);

			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairEvents\API\MigrationSummaryController();
					$controller->register_routes();
				}
			);
		}

		if ( Features::is_enabled( 'ticketing' ) ) {
			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairEvents\API\GroupPricingRulesController();
					$controller->register_routes();
				}
			);

			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairEvents\API\GroupPermissionRulesController();
					$controller->register_routes();
				}
			);

			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairEvents\API\TicketsController();
					$controller->register_routes();
				}
			);

			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairEvents\API\InvitationTokensController();
					$controller->register_routes();
				}
			);
		}

		if ( Features::is_enabled( 'event-tools' ) ) {
			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairEvents\API\EventDuplicationController();
					$controller->register_routes();
				}
			);

			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairEvents\API\EventMergeController();
					$controller->register_routes();
				}
			);
		}
	}

	/**
	 * Load frontend pages
	 *
	 * @return void
	 */
	private function load_frontend() {
		if ( Features::is_enabled( 'galleries' ) ) {
			\FairEvents\Frontend\EventGalleryPage::init();
		}
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
