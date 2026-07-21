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
		// Default: rely on WordPress.org language packs. The `bundled-translations`
		// feature flag opts into loading the .mo files we ship in `languages/`,
		// which is useful while a locale is below the WP.org publish threshold.
		add_action(
			'init',
			function () {
				if ( Features::is_enabled( 'bundled-translations' ) ) {
					load_plugin_textdomain( 'fair-events', false, 'fair-events/languages' );
				}
			}
		);

		add_action( 'init', array( $this, 'register_post_types' ) );
		$this->load_hooks();
		$this->load_patterns();
		$this->load_admin();
		$this->load_settings();
		$this->load_rest_api();
		$this->load_frontend();
		$this->load_post_cleanup();
		$this->load_auto_create_event();
		$this->load_title_sync();

		// Shared REST API endpoints (block renderer).
		new \FairEventsShared\API\RestHooks();
	}

	/**
	 * Load all plugin hooks and functionality
	 *
	 * @return void
	 */
	private function load_hooks() {
		new \FairEvents\Hooks\BlockHooks();
		new \FairEvents\Hooks\CalendarButtonHooks();
		new \FairEvents\Hooks\OpenGraphHooks();
		new \FairEvents\Hooks\AdminBarHooks();
		\FairEvents\Hooks\PaymentHooks::init();
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
		// Core endpoints — always on. Manage-event UI and EventDates schema
		// depend on these; they belong to `core`.
		new \FairEvents\API\DateOptionsEndpoint();
		new \FairEvents\API\UserGroupOptionsEndpoint();

		// Event Dates controller.
		add_action(
			'rest_api_init',
			function () {
				$controller = new \FairEvents\API\EventDatesController();
				$controller->register_routes();
			}
		);

		// Public events controller — registers `/fair-events/v1/events`,
		// which the core calendar admin page consumes. Despite the
		// "cross-site JSON" framing in the ticket, this is a core endpoint.
		add_action(
			'rest_api_init',
			function () {
				$controller = new \FairEvents\API\PublicEventsController();
				$controller->register_routes();
			}
		);

		// Categories controller — registers `/fair-events/v1/sources/categories`,
		// used by the Manage Event admin page to create categories on the fly.
		add_action(
			'rest_api_init',
			function () {
				$controller = new \FairEvents\API\CategoriesController();
				$controller->register_routes();
			}
		);

		// Calendar feed controller — registers `/fair-events/v1/calendar.ics`,
		// a public read-only ICS mirror of the /events feed for subscribing
		// in calendar clients.
		add_action(
			'rest_api_init',
			function () {
				$controller = new \FairEvents\API\CalendarFeedController();
				$controller->register_routes();
			}
		);

		// Event lookup controller — registers `/fair-events/v1/lookup-url`,
		// used by the Quick Add modal's "From URL" tab to prefill event
		// details from a pasted event page.
		add_action(
			'rest_api_init',
			function () {
				$controller = new \FairEvents\API\EventLookupController();
				$controller->register_routes();
			}
		);

		if ( Features::is_enabled( 'ticketing' ) ) {
			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairEvents\API\TicketsController();
					$controller->register_routes();
				}
			);
		}

		// GetTickets controller — registers the public ticket purchase endpoint when fair-audience is absent.
		if ( ! class_exists( \FairAudience\API\EventSignupController::class ) ) {
			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairEvents\API\GetTicketsController();
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
		// Gallery frontend is loaded by fair-events-experimental when active.
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
	 * Load auto-create event hook for fair_event posts
	 *
	 * @return void
	 */
	private function load_auto_create_event() {
		add_action( 'wp_after_insert_post', array( $this, 'auto_create_event_date' ), 10, 4 );
	}

	/**
	 * Load title sync hook: primary post title → event_date title
	 *
	 * @return void
	 */
	private function load_title_sync() {
		add_action( 'save_post', array( $this, 'sync_title_to_event_date' ), 20, 2 );
	}

	/**
	 * Sync post title to event_date title when the post is the primary linked post
	 *
	 * @param int      $post_id Post ID.
	 * @param \WP_Post $post    Post object.
	 * @return void
	 */
	public function sync_title_to_event_date( $post_id, $post ) {
		if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
			return;
		}

		if ( wp_is_post_revision( $post_id ) ) {
			return;
		}

		$enabled_post_types = \FairEvents\Settings\Settings::get_enabled_post_types();
		if ( ! in_array( $post->post_type, $enabled_post_types, true ) ) {
			return;
		}

		// Look up the event_date where this post is the primary (event_id = post_id).
		$event_date = \FairEvents\Models\EventDates::get_by_event_id( $post_id );
		if ( ! $event_date ) {
			return;
		}

		// Only sync if this post is the primary post.
		if ( (int) $event_date->event_id !== (int) $post_id ) {
			return;
		}

		\FairEvents\Models\EventDates::update_by_id(
			$event_date->id,
			array( 'title' => $post->post_title )
		);
	}

	/**
	 * Auto-create an event_dates row when a fair_event post is first created
	 *
	 * @param int      $post_id     Post ID.
	 * @param \WP_Post $post        Post object.
	 * @param bool     $update      Whether this is an existing post being updated.
	 * @param \WP_Post $post_before Post object before the update (null for new posts).
	 * @return void
	 */
	public function auto_create_event_date( $post_id, $post, $update, $post_before ) {
		// Only for new fair_event posts (not updates).
		if ( $update ) {
			return;
		}

		if ( \FairEvents\PostTypes\Event::POST_TYPE !== $post->post_type ) {
			return;
		}

		// Guard: don't create if an event_date already exists for this post.
		$existing = \FairEvents\Models\EventDates::get_by_event_id( $post_id );
		if ( $existing ) {
			return;
		}

		// Create a minimal event_dates row.
		\FairEvents\Models\EventDates::save( $post_id, null, null, false );

		// Also add to junction table.
		$event_date = \FairEvents\Models\EventDates::get_by_event_id( $post_id );
		if ( $event_date ) {
			\FairEvents\Models\EventDates::add_linked_post( $event_date->id, $post_id );
		}
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
