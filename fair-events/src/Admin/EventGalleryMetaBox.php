<?php
/**
 * Event Gallery Meta Box
 *
 * @package FairEvents
 */

namespace FairEvents\Admin;

use FairEvents\Taxonomies\EventGallery;

defined( 'WPINC' ) || die;

/**
 * Meta box for managing event photos in the event editor.
 */
class EventGalleryMetaBox {

	/**
	 * Initialize hooks for gallery meta box.
	 */
	public static function init() {
		add_action( 'add_meta_boxes', array( __CLASS__, 'add_meta_box' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'enqueue_scripts' ) );
		add_action( 'save_post_fair_event', array( __CLASS__, 'save_gallery' ), 10, 2 );
	}

	/**
	 * Add gallery meta box to event edit screen.
	 */
	public static function add_meta_box() {
		add_meta_box(
			'fair_event_gallery',
			__( 'Event Photos', 'fair-events' ),
			array( __CLASS__, 'render_meta_box' ),
			'fair_event',
			'normal',
			'default'
		);
	}

	/**
	 * Render gallery meta box content.
	 *
	 * @param WP_Post $post Post object.
	 */
	public static function render_meta_box( $post ) {
		wp_nonce_field( 'fair_event_gallery_meta_box', 'fair_event_gallery_nonce' );

		$term           = EventGallery::get_term_for_event( $post->ID );
		$attachment_ids = array();

		if ( $term ) {
			$attachments = get_posts(
				array(
					'post_type'      => 'attachment',
					'posts_per_page' => -1,
					'tax_query'      => array(
						array(
							'taxonomy' => EventGallery::TAXONOMY,
							'field'    => 'term_id',
							'terms'    => $term->term_id,
						),
					),
				)
			);

			$attachment_ids = wp_list_pluck( $attachments, 'ID' );
		}

		?>
		<div id="fair-event-gallery-container">
			<p class="description">
				<?php esc_html_e( 'Photos linked to this event. Click "Add Photos" to select from media library or upload new images.', 'fair-events' ); ?>
			</p>

			<div id="fair-event-gallery-preview" style="display: flex; flex-wrap: wrap; gap: 10px; margin: 15px 0;">
				<?php foreach ( $attachment_ids as $attachment_id ) : ?>
					<?php echo wp_kses_post( self::render_photo_item( $attachment_id ) ); ?>
				<?php endforeach; ?>
			</div>

			<input type="hidden" name="fair_event_gallery_ids" id="fair-event-gallery-ids"
					value="<?php echo esc_attr( implode( ',', $attachment_ids ) ); ?>" />

			<button type="button" class="button button-secondary" id="fair-event-gallery-add">
				<?php esc_html_e( 'Add Photos', 'fair-events' ); ?>
			</button>

			<span id="fair-event-gallery-count" style="margin-left: 10px; color: #666;">
				<?php
				echo esc_html(
					sprintf(
						/* translators: %d: number of photos */
						_n( '%d photo', '%d photos', count( $attachment_ids ), 'fair-events' ),
						count( $attachment_ids )
					)
				);
				?>
			</span>
		</div>
		<?php
	}

	/**
	 * Render individual photo item.
	 *
	 * @param int $attachment_id Attachment ID.
	 * @return string Photo item HTML.
	 */
	private static function render_photo_item( $attachment_id ) {
		$thumb_url = wp_get_attachment_image_url( $attachment_id, 'thumbnail' );
		$title     = get_the_title( $attachment_id );

		return sprintf(
			'<div class="fair-event-photo-item" data-id="%d" style="position: relative;">
				<img src="%s" alt="%s" style="width: 100px; height: 100px; object-fit: cover;" />
				<button type="button" class="fair-event-photo-remove"
						style="position: absolute; top: 5px; right: 5px; background: rgba(0,0,0,0.7); color: white; border: none; border-radius: 3px; cursor: pointer; padding: 2px 6px;"
						title="%s">
					×
				</button>
			</div>',
			$attachment_id,
			esc_url( $thumb_url ),
			esc_attr( $title ),
			esc_attr__( 'Remove', 'fair-events' )
		);
	}

	/**
	 * Enqueue scripts for media uploader.
	 *
	 * @param string $hook Hook suffix.
	 */
	public static function enqueue_scripts( $hook ) {
		global $post;

		if ( 'post.php' !== $hook && 'post-new.php' !== $hook ) {
			return;
		}

		if ( ! $post || 'fair_event' !== $post->post_type ) {
			return;
		}

		wp_enqueue_media();

		$asset_file = include FAIR_EVENTS_PLUGIN_DIR . 'build/admin/event-gallery.asset.php';

		wp_enqueue_script(
			'fair-event-gallery',
			FAIR_EVENTS_PLUGIN_URL . 'build/admin/event-gallery.js',
			$asset_file['dependencies'],
			$asset_file['version'],
			true
		);

		wp_localize_script(
			'fair-event-gallery',
			'fairEventGallery',
			array(
				'addPhotos'    => __( 'Add Photos to Event', 'fair-events' ),
				'selectPhotos' => __( 'Select Photos', 'fair-events' ),
				'photoCount'   => array(
					/* translators: %d: number of photos */
					'singular' => __( '%d photo', 'fair-events' ),
					/* translators: %d: number of photos */
					'plural'   => __( '%d photos', 'fair-events' ),
				),
			)
		);
	}

	/**
	 * Save gallery assignments when event is saved.
	 *
	 * @param int     $post_id Post ID.
	 * @param WP_Post $post    Post object.
	 */
	public static function save_gallery( $post_id, $post ) {
		// Verify nonce.
		if ( ! isset( $_POST['fair_event_gallery_nonce'] ) ||
			! wp_verify_nonce( $_POST['fair_event_gallery_nonce'], 'fair_event_gallery_meta_box' ) ) {
			return;
		}

		// Skip autosaves.
		if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
			return;
		}

		// Check permissions.
		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return;
		}

		$term = EventGallery::get_term_for_event( $post_id );
		if ( ! $term ) {
			return; // Term should be created by EventGallery::sync_event_term.
		}

		// Get new gallery IDs.
		$gallery_ids = array();
		if ( isset( $_POST['fair_event_gallery_ids'] ) && ! empty( $_POST['fair_event_gallery_ids'] ) ) {
			$gallery_ids = array_map( 'absint', explode( ',', $_POST['fair_event_gallery_ids'] ) );
		}

		// Get currently assigned attachments.
		$current_attachments = get_posts(
			array(
				'post_type'      => 'attachment',
				'posts_per_page' => -1,
				'fields'         => 'ids',
				'tax_query'      => array(
					array(
						'taxonomy' => EventGallery::TAXONOMY,
						'field'    => 'term_id',
						'terms'    => $term->term_id,
					),
				),
			)
		);

		// Remove attachments no longer in gallery.
		$to_remove = array_diff( $current_attachments, $gallery_ids );
		foreach ( $to_remove as $attachment_id ) {
			wp_delete_object_term_relationships( $attachment_id, EventGallery::TAXONOMY );
		}

		// Add new attachments.
		$to_add = array_diff( $gallery_ids, $current_attachments );
		foreach ( $to_add as $attachment_id ) {
			// Remove from any other event (enforce 1-to-1).
			wp_delete_object_term_relationships( $attachment_id, EventGallery::TAXONOMY );
			// Assign to this event.
			wp_set_object_terms( $attachment_id, $term->term_id, EventGallery::TAXONOMY, false );
		}
	}
}
