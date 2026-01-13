<?php
/**
 * Media Library Hooks
 *
 * @package FairEvents
 */

namespace FairEvents\Admin;

use FairEvents\Taxonomies\EventGallery;

defined( 'WPINC' ) || die;

/**
 * Media Library integration for event gallery.
 */
class MediaLibraryHooks {

	/**
	 * Initialize hooks for media library.
	 */
	public static function init() {
		// Add event field to attachment details.
		add_filter( 'attachment_fields_to_edit', array( __CLASS__, 'add_event_field' ), 10, 2 );
		add_filter( 'attachment_fields_to_save', array( __CLASS__, 'save_event_field' ), 10, 2 );

		// Add dropdown filter to media library.
		add_action( 'restrict_manage_posts', array( __CLASS__, 'add_event_filter_dropdown' ) );
		add_filter( 'pre_get_posts', array( __CLASS__, 'filter_by_event' ) );

		// Add event column to media library (optional).
		add_filter( 'manage_media_columns', array( __CLASS__, 'add_event_column' ) );
		add_action( 'manage_media_custom_column', array( __CLASS__, 'display_event_column' ), 10, 2 );
	}

	/**
	 * Add event selector field to attachment edit screen.
	 *
	 * @param array   $form_fields Form fields array.
	 * @param WP_Post $post        Post object.
	 * @return array Modified form fields.
	 */
	public static function add_event_field( $form_fields, $post ) {
		// Get current event assignment.
		$terms            = wp_get_object_terms( $post->ID, EventGallery::TAXONOMY );
		$current_event_id = 0;

		if ( ! empty( $terms ) && ! is_wp_error( $terms ) ) {
			$current_event_id = EventGallery::get_event_id_from_term( $terms[0]->term_id );
		}

		// Get all events for dropdown.
		$events = get_posts(
			array(
				'post_type'      => 'fair_event',
				'posts_per_page' => -1,
				'orderby'        => 'title',
				'order'          => 'ASC',
				'post_status'    => 'any',
			)
		);

		$options = '<option value="">' . __( '— Select Event —', 'fair-events' ) . '</option>';
		foreach ( $events as $event ) {
			$selected = selected( $current_event_id, $event->ID, false );
			$options .= sprintf(
				'<option value="%d"%s>%s</option>',
				$event->ID,
				$selected,
				esc_html( $event->post_title )
			);
		}

		$form_fields['fair_event'] = array(
			'label' => __( 'Event', 'fair-events' ),
			'input' => 'html',
			'html'  => sprintf(
				'<select name="attachments[%d][fair_event]" id="attachments-%d-fair_event">%s</select>',
				$post->ID,
				$post->ID,
				$options
			),
			'helps' => __( 'Link this image to an event', 'fair-events' ),
		);

		return $form_fields;
	}

	/**
	 * Save event assignment for attachment.
	 *
	 * @param array $post       Post data array.
	 * @param array $attachment Attachment data array.
	 * @return array Modified post data.
	 */
	public static function save_event_field( $post, $attachment ) {
		if ( ! isset( $attachment['fair_event'] ) ) {
			return $post;
		}

		$event_id = absint( $attachment['fair_event'] );

		// Remove existing event assignments (enforce 1-to-1).
		wp_delete_object_term_relationships( $post['ID'], EventGallery::TAXONOMY );

		// Assign to new event if selected.
		if ( $event_id > 0 ) {
			$term = EventGallery::get_term_for_event( $event_id );
			if ( $term ) {
				wp_set_object_terms( $post['ID'], $term->term_id, EventGallery::TAXONOMY, false );
			}
		}

		return $post;
	}

	/**
	 * Add event filter dropdown to media library.
	 */
	public static function add_event_filter_dropdown() {
		global $pagenow;

		if ( 'upload.php' !== $pagenow ) {
			return;
		}

		$selected = isset( $_GET['fair_event_filter'] ) ? absint( $_GET['fair_event_filter'] ) : 0;

		$events = get_posts(
			array(
				'post_type'      => 'fair_event',
				'posts_per_page' => -1,
				'orderby'        => 'title',
				'order'          => 'ASC',
				'post_status'    => 'publish',
			)
		);

		echo '<select name="fair_event_filter">';
		echo '<option value="">' . esc_html__( 'All Events', 'fair-events' ) . '</option>';
		foreach ( $events as $event ) {
			printf(
				'<option value="%d"%s>%s</option>',
				$event->ID,
				selected( $selected, $event->ID, false ),
				esc_html( $event->post_title )
			);
		}
		echo '</select>';
	}

	/**
	 * Filter media library by selected event.
	 *
	 * @param WP_Query $query Query object.
	 */
	public static function filter_by_event( $query ) {
		global $pagenow;

		if ( 'upload.php' !== $pagenow || ! $query->is_main_query() ) {
			return;
		}

		if ( empty( $_GET['fair_event_filter'] ) ) {
			return;
		}

		$event_id = absint( $_GET['fair_event_filter'] );
		$term     = EventGallery::get_term_for_event( $event_id );

		if ( $term ) {
			$query->set(
				'tax_query',
				array(
					array(
						'taxonomy' => EventGallery::TAXONOMY,
						'field'    => 'term_id',
						'terms'    => $term->term_id,
					),
				)
			);
		}
	}

	/**
	 * Add event column to media library list.
	 *
	 * @param array $columns Columns array.
	 * @return array Modified columns.
	 */
	public static function add_event_column( $columns ) {
		$columns['fair_event'] = __( 'Event', 'fair-events' );
		return $columns;
	}

	/**
	 * Display event name in media library column.
	 *
	 * @param string $column_name Column name.
	 * @param int    $post_id     Post ID.
	 */
	public static function display_event_column( $column_name, $post_id ) {
		if ( 'fair_event' !== $column_name ) {
			return;
		}

		$terms = wp_get_object_terms( $post_id, EventGallery::TAXONOMY );

		if ( empty( $terms ) || is_wp_error( $terms ) ) {
			echo '—';
			return;
		}

		$event_id = EventGallery::get_event_id_from_term( $terms[0]->term_id );

		if ( $event_id ) {
			$event = get_post( $event_id );
			if ( $event ) {
				printf(
					'<a href="%s">%s</a>',
					esc_url( get_edit_post_link( $event_id ) ),
					esc_html( $event->post_title )
				);
				return;
			}
		}

		echo esc_html( $terms[0]->name );
	}
}
