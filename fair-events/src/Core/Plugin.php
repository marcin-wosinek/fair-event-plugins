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
		$this->load_post_cleanup();
	}

	/**
	 * Load all plugin hooks and functionality
	 *
	 * @return void
	 */
	private function load_hooks() {
		new \FairEvents\Hooks\BlockHooks();
		new \FairEvents\Hooks\CalendarButtonHooks();
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

		$facebook_settings = new \FairEvents\Settings\FacebookSettings();
		$facebook_settings->init();
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

		// Event Dates controller.
		add_action(
			'rest_api_init',
			function () {
				$controller = new \FairEvents\API\EventDatesController();
				$controller->register_routes();
			}
		);

		// Image Export controller.
		add_action(
			'rest_api_init',
			function () {
				$controller = new \FairEvents\API\ImageExportController();
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

		// Weekly Events controller.
		add_action(
			'rest_api_init',
			function () {
				$controller = new \FairEvents\API\WeeklyEventsController();
				$controller->register_routes();
			}
		);

		// Facebook controller.
		add_action(
			'rest_api_init',
			function () {
				$controller = new \FairEvents\API\FacebookController();
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
	 * Load post deletion cleanup hooks
	 *
	 * @return void
	 */
	private function load_post_cleanup() {
		add_action( 'before_delete_post', array( $this, 'cleanup_linked_posts_on_delete' ) );
	}

	/**
	 * Clean up junction table when a post is deleted
	 *
	 * If the deleted post was the primary, promotes the next linked post.
	 *
	 * @param int $post_id Post ID being deleted.
	 * @return void
	 *
	 * phpcs:disable WordPress.DB.DirectDatabaseQuery
	 */
	public function cleanup_linked_posts_on_delete( $post_id ) {
		$event_date = \FairEvents\Models\EventDates::get_by_event_id( $post_id );

		if ( ! $event_date ) {
			return;
		}

		// Remove from junction table.
		\FairEvents\Models\EventDates::remove_linked_post_from_all( $post_id );

		// If this was the primary post, promote next linked post.
		if ( (int) $event_date->event_id === (int) $post_id ) {
			$remaining_post_ids = \FairEvents\Models\EventDates::get_linked_post_ids( $event_date->id );

			if ( ! empty( $remaining_post_ids ) ) {
				$new_primary = $remaining_post_ids[0];
				\FairEvents\Models\EventDates::update_by_id(
					$event_date->id,
					array( 'event_id' => $new_primary )
				);
			} else {
				// No more linked posts, clear event_id.
				\FairEvents\Models\EventDates::update_by_id(
					$event_date->id,
					array(
						'event_id'  => null,
						'link_type' => 'none',
					)
				);
			}
		}
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
