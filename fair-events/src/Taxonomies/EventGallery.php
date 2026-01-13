<?php
/**
 * Event Gallery Taxonomy
 *
 * @package FairEvents
 */

namespace FairEvents\Taxonomies;

defined( 'WPINC' ) || die;

/**
 * Event Gallery taxonomy for linking attachments to events.
 */
class EventGallery {

	/**
	 * Taxonomy name.
	 */
	const TAXONOMY = 'fair_event_gallery';

	/**
	 * Register taxonomy and hooks.
	 */
	public static function register() {
		register_taxonomy(
			self::TAXONOMY,
			'attachment',
			array(
				'label'              => __( 'Event Gallery', 'fair-events' ),
				'labels'             => array(
					'name'          => __( 'Event Galleries', 'fair-events' ),
					'singular_name' => __( 'Event Gallery', 'fair-events' ),
					'search_items'  => __( 'Search Events', 'fair-events' ),
					'all_items'     => __( 'All Events', 'fair-events' ),
					'edit_item'     => __( 'Edit Event', 'fair-events' ),
					'update_item'   => __( 'Update Event', 'fair-events' ),
					'add_new_item'  => __( 'Add Event', 'fair-events' ),
					'new_item_name' => __( 'New Event', 'fair-events' ),
				),
				'hierarchical'       => false,
				'public'             => false,
				'show_ui'            => true,
				'show_admin_column'  => true,
				'show_in_nav_menus'  => false,
				'show_in_quick_edit' => false,
				'show_in_rest'       => true,
				'rest_base'          => 'event-gallery',
				'rewrite'            => false,
				'meta_box_cb'        => false, // Custom meta box instead.
			)
		);

		// Hooks for term synchronization.
		add_action( 'save_post_fair_event', array( __CLASS__, 'sync_event_term' ), 10, 2 );
		add_action( 'before_delete_post', array( __CLASS__, 'maybe_delete_term' ) );
		add_action( 'wp_trash_post', array( __CLASS__, 'maybe_hide_term' ) );
		add_action( 'untrashed_post', array( __CLASS__, 'maybe_restore_term' ) );
	}

	/**
	 * Create or update taxonomy term when event is saved.
	 *
	 * @param int     $post_id Event post ID.
	 * @param WP_Post $post    Event post object.
	 */
	public static function sync_event_term( $post_id, $post ) {
		// Skip autosaves and revisions.
		if ( wp_is_post_autosave( $post_id ) || wp_is_post_revision( $post_id ) ) {
			return;
		}

		$term_slug = 'event-' . $post_id;
		$term_name = $post->post_title;

		// Check if term exists.
		$term = get_term_by( 'slug', $term_slug, self::TAXONOMY );

		if ( $term ) {
			// Update existing term if title changed.
			if ( $term->name !== $term_name ) {
				wp_update_term(
					$term->term_id,
					self::TAXONOMY,
					array( 'name' => $term_name )
				);
			}
		} else {
			// Create new term.
			wp_insert_term(
				$term_name,
				self::TAXONOMY,
				array(
					'slug'        => $term_slug,
					'description' => sprintf(
						/* translators: %s: event title */
						__( 'Photos for event: %s', 'fair-events' ),
						$term_name
					),
				)
			);
		}

		// Store event ID in term meta for reverse lookup.
		if ( $term || ( $term = get_term_by( 'slug', $term_slug, self::TAXONOMY ) ) ) {
			update_term_meta( $term->term_id, 'event_id', $post_id );
		}
	}

	/**
	 * Delete term when event is permanently deleted.
	 *
	 * @param int $post_id Post ID being deleted.
	 */
	public static function maybe_delete_term( $post_id ) {
		if ( 'fair_event' !== get_post_type( $post_id ) ) {
			return;
		}

		$term_slug = 'event-' . $post_id;
		$term      = get_term_by( 'slug', $term_slug, self::TAXONOMY );

		if ( $term ) {
			// Delete term (removes all photo associations).
			wp_delete_term( $term->term_id, self::TAXONOMY );
		}
	}

	/**
	 * Hide term when event is trashed.
	 *
	 * @param int $post_id Post ID being trashed.
	 */
	public static function maybe_hide_term( $post_id ) {
		if ( 'fair_event' !== get_post_type( $post_id ) ) {
			return;
		}

		$term_slug = 'event-' . $post_id;
		$term      = get_term_by( 'slug', $term_slug, self::TAXONOMY );

		if ( $term ) {
			update_term_meta( $term->term_id, 'event_trashed', true );
		}
	}

	/**
	 * Restore term visibility when event is untrashed.
	 *
	 * @param int $post_id Post ID being untrashed.
	 */
	public static function maybe_restore_term( $post_id ) {
		if ( 'fair_event' !== get_post_type( $post_id ) ) {
			return;
		}

		$term_slug = 'event-' . $post_id;
		$term      = get_term_by( 'slug', $term_slug, self::TAXONOMY );

		if ( $term ) {
			delete_term_meta( $term->term_id, 'event_trashed' );
		}
	}

	/**
	 * Get event ID from term.
	 *
	 * @param int $term_id Term ID.
	 * @return int|false Event post ID or false.
	 */
	public static function get_event_id_from_term( $term_id ) {
		return get_term_meta( $term_id, 'event_id', true );
	}

	/**
	 * Get term for event.
	 *
	 * @param int $event_id Event post ID.
	 * @return WP_Term|false Term object or false.
	 */
	public static function get_term_for_event( $event_id ) {
		$term_slug = 'event-' . $event_id;
		return get_term_by( 'slug', $term_slug, self::TAXONOMY );
	}
}
