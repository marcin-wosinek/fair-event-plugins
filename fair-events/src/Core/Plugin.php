<?php
/**
 * Plugin core class for Fair Events
 *
 * @package FairEvents
 */

namespace FairEvents\Core;

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
		add_action( 'init', array( $this, 'register_post_types' ) );
		$this->load_hooks();
		$this->load_patterns();
		$this->load_admin();
		$this->load_settings();
		$this->load_rest_api();
		$this->load_frontend();
	}

	/**
	 * Load all plugin hooks and functionality
	 *
	 * @return void
	 */
	private function load_hooks() {
		new \FairEvents\Hooks\BlockHooks();
	}

	/**
	 * Load and initialize block patterns
	 *
	 * @return void
	 */
	private function load_patterns() {
		$patterns = new \FairEvents\Patterns\Patterns();
		$patterns->init();
	}

	/**
	 * Load and initialize admin pages
	 *
	 * @return void
	 */
	private function load_admin() {
		if ( is_admin() ) {
			$admin = new \FairEvents\Admin\AdminPages();
			$admin->init();

			\FairEvents\Admin\MediaLibraryHooks::init();
			\FairEvents\Admin\EventGalleryMetaBox::init();
			\FairEvents\Admin\MediaBatchActions::init();
		}
	}

	/**
	 * Load and initialize settings
	 *
	 * @return void
	 */
	private function load_settings() {
		$settings = new \FairEvents\Settings\Settings();
		$settings->init();
	}

	/**
	 * Load and initialize REST API endpoints
	 *
	 * @return void
	 */
	private function load_rest_api() {
		new \FairEvents\API\DateOptionsEndpoint();
		new \FairEvents\API\UserGroupOptionsEndpoint();

		// Event Sources controller.
		add_action(
			'rest_api_init',
			function () {
				$controller = new \FairEvents\API\EventSourceController();
				$controller->register_routes();
			}
		);

		// Event Proposal controller.
		add_action(
			'rest_api_init',
			function () {
				$controller = new \FairEvents\API\EventProposalController();
				$controller->register_routes();
			}
		);

		// Event Gallery endpoint.
		add_action(
			'rest_api_init',
			function () {
				$controller = new \FairEvents\API\EventGalleryEndpoint();
				$controller->register_routes();
			}
		);

		// Photo Likes controller.
		add_action(
			'rest_api_init',
			function () {
				$controller = new \FairEvents\API\PhotoLikesController();
				$controller->register_routes();
			}
		);

		// Migration controller.
		add_action(
			'rest_api_init',
			function () {
				$controller = new \FairEvents\API\MigrationController();
				$controller->register_routes();
			}
		);

		// Public Events controller (JSON export for cross-site sharing).
		add_action(
			'rest_api_init',
			function () {
				$controller = new \FairEvents\API\PublicEventsController();
				$controller->register_routes();
			}
		);

		// Venue controller.
		add_action(
			'rest_api_init',
			function () {
				$controller = new \FairEvents\API\VenueController();
				$controller->register_routes();
			}
		);

		// Add event relationship to attachment REST responses.
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

							if ( ! $event_photo ) {
								return null;
							}

							$event = get_post( $event_photo->event_id );

							return $event ? array(
								'id'    => $event->ID,
								'title' => $event->post_title,
								'link'  => get_permalink( $event->ID ),
							) : null;
						},
						'schema'       => array(
							'description' => __( 'Event associated with this image', 'fair-events' ),
							'type'        => array( 'object', 'null' ),
						),
					)
				);
			}
		);
	}

	/**
	 * Load frontend pages
	 *
	 * @return void
	 */
	private function load_frontend() {
		\FairEvents\Frontend\EventGalleryPage::init();
	}

	/**
	 * Register custom post types
	 *
	 * @return void
	 */
	public function register_post_types() {
		\FairEvents\PostTypes\Event::register();
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
