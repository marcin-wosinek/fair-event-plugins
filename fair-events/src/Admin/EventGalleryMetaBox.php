<?php
/**
 * Event Gallery Meta Box
 *
 * @package FairEvents
 */

namespace FairEvents\Admin;

use FairEvents\Database\EventPhotoRepository;

defined( 'WPINC' ) || die;

/**
 * Meta box for displaying event photo count and gallery link.
 */
class EventGalleryMetaBox {

	/**
	 * Initialize hooks for gallery meta box.
	 */
	public static function init() {
		add_action( 'add_meta_boxes', array( __CLASS__, 'add_meta_box' ) );
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
			'side',
			'default'
		);
	}

	/**
	 * Render gallery meta box content.
	 *
	 * @param WP_Post $post Post object.
	 */
	public static function render_meta_box( $post ) {
		$repository  = new EventPhotoRepository();
		$photo_count = $repository->get_count_by_event( $post->ID );

		?>
		<p>
			<?php
			echo esc_html(
				sprintf(
					/* translators: %d: number of photos */
					_n( '%d photo linked to this event.', '%d photos linked to this event.', $photo_count, 'fair-events' ),
					$photo_count
				)
			);
			?>
		</p>

		<?php if ( 'publish' === $post->post_status && $photo_count > 0 ) : ?>
			<p>
				<a href="<?php echo esc_url( \FairEvents\Frontend\EventGalleryPage::get_gallery_url( $post->ID ) ); ?>" target="_blank" class="button">
					<?php esc_html_e( 'View Public Gallery', 'fair-events' ); ?> ↗
				</a>
			</p>
		<?php endif; ?>
		<?php
	}
}
