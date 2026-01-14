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

		// Bulk upload page.
		add_action( 'post-upload-ui', array( __CLASS__, 'add_bulk_upload_event_selector' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'enqueue_bulk_upload_scripts' ) );
		add_action( 'add_attachment', array( __CLASS__, 'auto_assign_event_on_upload' ) );
		add_action( 'wp_ajax_fair_events_set_bulk_upload_event', array( __CLASS__, 'ajax_set_bulk_upload_event' ) );
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

	/**
	 * Add event selector to bulk upload page.
	 */
	public static function add_bulk_upload_event_selector() {
		$events = get_posts(
			array(
				'post_type'      => 'fair_event',
				'posts_per_page' => -1,
				'orderby'        => 'title',
				'order'          => 'ASC',
				'post_status'    => 'any',
			)
		);

		$selected = get_user_meta( get_current_user_id(), 'fair_events_bulk_upload_event', true );

		?>
		<div id="fair-events-bulk-upload" style="margin: 20px 0; padding: 15px; background: #f0f0f1; border: 1px solid #c3c4c7; border-radius: 4px;">
			<h3 style="margin-top: 0;"><?php esc_html_e( 'Event Gallery', 'fair-events' ); ?></h3>
			<p class="description">
				<?php esc_html_e( 'Automatically link uploaded photos to an event. Select an event below before uploading.', 'fair-events' ); ?>
			</p>
			<p>
				<label for="fair-events-bulk-upload-selector">
					<strong><?php esc_html_e( 'Event:', 'fair-events' ); ?></strong>
				</label>
				<select id="fair-events-bulk-upload-selector" style="margin-left: 10px; min-width: 250px;">
					<option value=""><?php esc_html_e( '— No Event (Manual Assignment) —', 'fair-events' ); ?></option>
					<?php foreach ( $events as $event ) : ?>
						<option value="<?php echo esc_attr( $event->ID ); ?>" <?php selected( $selected, $event->ID ); ?>>
							<?php echo esc_html( $event->post_title ); ?>
						</option>
					<?php endforeach; ?>
				</select>
				<span id="fair-events-bulk-upload-status" style="margin-left: 10px; color: #666;"></span>
			</p>
		</div>
		<?php
	}

	/**
	 * Enqueue scripts for bulk upload page.
	 *
	 * @param string $hook Hook suffix.
	 */
	public static function enqueue_bulk_upload_scripts( $hook ) {
		if ( 'media-new.php' !== $hook ) {
			return;
		}

		wp_enqueue_script( 'jquery' );

		wp_add_inline_script(
			'jquery',
			"
			jQuery(document).ready(function($) {
				console.log('Fair Events bulk upload script loaded');

				$('#fair-events-bulk-upload-selector').on('change', function() {
					var eventId = $(this).val();
					var statusEl = $('#fair-events-bulk-upload-status');

					console.log('Event selected:', eventId);

					statusEl.text('Saving...').css('color', '#666');

					$.post(ajaxurl, {
						action: 'fair_events_set_bulk_upload_event',
						event_id: eventId,
						nonce: '" . wp_create_nonce( 'fair_events_bulk_upload' ) . "'
					}, function(response) {
						console.log('AJAX response:', response);
						if (response.success) {
							if (eventId) {
								statusEl.text('" . esc_js( __( 'Selected. New uploads will be linked to this event.', 'fair-events' ) ) . "').css('color', '#00a32a');
							} else {
								statusEl.text('').css('color', '#666');
							}
						} else {
							statusEl.text('Error saving selection').css('color', '#d63638');
						}
					}).fail(function(xhr, status, error) {
						console.error('AJAX error:', status, error);
						statusEl.text('Error: ' + error).css('color', '#d63638');
					});
				});
			});
			"
		);
	}

	/**
	 * AJAX handler to save selected event for bulk upload.
	 */
	public static function ajax_set_bulk_upload_event() {
		error_log( 'Fair Events: ajax_set_bulk_upload_event called' );

		check_ajax_referer( 'fair_events_bulk_upload', 'nonce' );

		if ( ! current_user_can( 'upload_files' ) ) {
			error_log( 'Fair Events: User does not have upload_files capability' );
			wp_send_json_error();
		}

		$event_id = isset( $_POST['event_id'] ) ? absint( $_POST['event_id'] ) : 0;
		$user_id  = get_current_user_id();

		error_log( 'Fair Events: Saving event_id ' . $event_id . ' for user ' . $user_id );

		update_user_meta( $user_id, 'fair_events_bulk_upload_event', $event_id );

		// Verify it was saved.
		$saved_value = get_user_meta( $user_id, 'fair_events_bulk_upload_event', true );
		error_log( 'Fair Events: Verified saved value: ' . $saved_value );

		wp_send_json_success( array( 'saved_event_id' => $saved_value ) );
	}

	/**
	 * Automatically assign event to newly uploaded attachments.
	 *
	 * @param int $attachment_id Attachment ID.
	 */
	public static function auto_assign_event_on_upload( $attachment_id ) {
		error_log( 'Fair Events: auto_assign_event_on_upload called for attachment ' . $attachment_id );

		// Check if this is an image.
		if ( ! wp_attachment_is_image( $attachment_id ) ) {
			error_log( 'Fair Events: Not an image, skipping' );
			return;
		}

		// Get the selected event for bulk upload.
		$event_id = get_user_meta( get_current_user_id(), 'fair_events_bulk_upload_event', true );
		error_log( 'Fair Events: Retrieved event_id from user meta: ' . $event_id . ' for user ' . get_current_user_id() );

		if ( ! $event_id ) {
			error_log( 'Fair Events: No event selected, skipping auto-assignment' );
			return;
		}

		// Verify event exists.
		$event = get_post( $event_id );
		if ( ! $event || 'fair_event' !== $event->post_type ) {
			error_log( 'Fair Events: Event not found or wrong post type' );
			return;
		}

		// Get the event term.
		$term = EventGallery::get_term_for_event( $event_id );
		if ( ! $term ) {
			error_log( 'Fair Events: Term not found for event ' . $event_id );
			return;
		}

		error_log( 'Fair Events: Assigning attachment ' . $attachment_id . ' to term ' . $term->term_id );

		// Remove existing event assignments (enforce 1-to-1).
		wp_delete_object_term_relationships( $attachment_id, EventGallery::TAXONOMY );

		// Assign to the selected event.
		$result = wp_set_object_terms( $attachment_id, $term->term_id, EventGallery::TAXONOMY, false );

		if ( is_wp_error( $result ) ) {
			error_log( 'Fair Events: Error assigning term: ' . $result->get_error_message() );
		} else {
			error_log( 'Fair Events: Successfully assigned attachment to event' );
		}
	}
}
