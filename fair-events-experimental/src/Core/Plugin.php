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
				\FairEventsExperimental\Admin\MediaLibraryHooks::init();
				\FairEventsExperimental\Admin\MediaBatchActions::init();
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

			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairEventsExperimental\API\WeeklyEventsController();
					$controller->register_routes();
				}
			);
		}

		if ( Features::is_enabled( 'galleries' ) ) {
			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairEventsExperimental\API\EventGalleryEndpoint();
					$controller->register_routes();
				}
			);

			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairEventsExperimental\API\PhotoLikesController();
					$controller->register_routes();
				}
			);

			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairEventsExperimental\API\PhotoDownloadController();
					$controller->register_routes();
				}
			);

			// Attach event relationship to WP media REST responses so the
			// media library filter can show which event an image belongs to.
			add_action(
				'rest_api_init',
				function () {
					register_rest_field(
						'attachment',
						'fair_event',
						array(
							'get_callback' => function ( $object ) {
								$repository  = new \FairEvents\Database\EventPhotoRepository();
								$event_photo = $repository->get_event_for_attachment( $object['id'] );

								if ( ! $event_photo || ! $event_photo->event_date_id ) {
									return null;
								}

								$event_date = \FairEvents\Models\EventDates::get_by_id( $event_photo->event_date_id );

								return $event_date ? array(
									'event_date_id' => (int) $event_date->id,
									'title'         => $event_date->title,
								) : null;
							},
							'schema'       => array(
								'description' => __( 'Event associated with this image', 'fair-events-experimental' ),
								'type'        => array( 'object', 'null' ),
							),
						)
					);
				}
			);
		}

		if ( Features::is_enabled( 'migration' ) ) {
			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairEventsExperimental\API\MigrationController();
					$controller->register_routes();
				}
			);

			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairEventsExperimental\API\MigrationSummaryController();
					$controller->register_routes();
				}
			);
		}

		if ( Features::is_enabled( 'ticketing' ) ) {
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

			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairEventsExperimental\API\TicketsController();
					$controller->register_routes();
				}
			);

			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairEventsExperimental\API\InvitationTokensController();
					$controller->register_routes();
				}
			);
		}

		if ( Features::is_enabled( 'venues' ) ) {
			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairEventsExperimental\API\VenueController();
					$controller->register_routes();
				}
			);
		}

		if ( Features::is_enabled( 'event-tools' ) ) {
			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairEventsExperimental\API\EventDuplicationController();
					$controller->register_routes();
				}
			);

			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairEventsExperimental\API\EventMergeController();
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
