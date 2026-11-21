<?php
/**
 * Media fixtures for the event images API spec (#2397).
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/event-images-fixture.php <action> [args…]
 *
 * Actions:
 *   png <width> <height>          A plain PNG attachment.
 *   jpeg-rotated <width> <height> A JPEG stored as width × height with EXIF
 *                                 orientation 6, uploaded the normal way, so
 *                                 WordPress rotates it (when it can).
 *   jpeg-unrotated <w> <h>        The same JPEG, registered with its EXIF
 *                                 orientation kept, as when WordPress could
 *                                 not rotate it.
 *   pdf                           A non-image attachment.
 *   no-size                       An image attachment without dimensions.
 *   edit <id>                     Simulate an in-place edit (new file and size).
 *   trash <id> / restore <id>     Move an attachment to the trash and back.
 *   delete <id>                   Delete an attachment permanently.
 *   rows <event_date_id>          The stored association rows of an event.
 *   cleanup <id>…                 Delete attachments.
 *
 * Prints a single `E2E_EVENT_IMAGES:{json}` line.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

require_once ABSPATH . 'wp-admin/includes/image.php';

// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- test fixture, no cache to honour.

$fair_e2e_images_action = isset( $args[0] ) ? (string) $args[0] : '';
$fair_e2e_images_args   = array_slice( $args, 1 );

/**
 * JPEG bytes of a width × height image, optionally with an EXIF
 * orientation APP1 segment right after the SOI marker.
 *
 * @param int $width       Stored width.
 * @param int $height      Stored height.
 * @param int $orientation EXIF orientation, 0 for none.
 * @return string
 */
$fair_e2e_jpeg = static function ( $width, $height, $orientation = 0 ) {
	$image = imagecreatetruecolor( $width, $height );
	imagefill( $image, 0, 0, imagecolorallocate( $image, 40, 120, 200 ) );
	// A marker in the stored top-left corner, to tell orientations apart.
	imagefilledrectangle( $image, 0, 0, (int) ( $width / 4 ), (int) ( $height / 4 ), imagecolorallocate( $image, 230, 60, 60 ) );
	ob_start();
	imagejpeg( $image, null, 90 );
	$jpeg = ob_get_clean();
	if ( ! $orientation ) {
		return $jpeg;
	}
	// TIFF, little endian: one IFD entry, tag 0x0112 (Orientation), SHORT.
	$tiff = 'II' . pack( 'v', 42 ) . pack( 'V', 8 )
		. pack( 'v', 1 )
		. pack( 'v', 0x0112 ) . pack( 'v', 3 ) . pack( 'V', 1 ) . pack( 'v', $orientation ) . pack( 'v', 0 )
		. pack( 'V', 0 );
	$app1 = "Exif\0\0" . $tiff;
	return substr( $jpeg, 0, 2 ) . "\xFF\xE1" . pack( 'n', strlen( $app1 ) + 2 ) . $app1 . substr( $jpeg, 2 );
};

/**
 * Save bytes to uploads and register them as an attachment.
 *
 * @param string $name     File name.
 * @param string $bytes    File contents.
 * @param string $mime     MIME type.
 * @param bool   $generate Generate metadata the normal way.
 * @return int Attachment ID.
 */
$fair_e2e_attach = static function ( $name, $bytes, $mime, $generate = true ) {
	$upload = wp_upload_bits( $name, null, $bytes );
	if ( ! empty( $upload['error'] ) ) {
		WP_CLI::error( $upload['error'] );
	}
	$attachment_id = wp_insert_attachment(
		array(
			'post_mime_type' => $mime,
			'post_title'     => preg_replace( '/\.[a-z]+$/', '', $name ),
			'post_status'    => 'inherit',
		),
		$upload['file']
	);
	if ( $generate ) {
		wp_update_attachment_metadata( $attachment_id, wp_generate_attachment_metadata( $attachment_id, $upload['file'] ) );
	}
	return $attachment_id;
};

$fair_e2e_describe = static function ( $attachment_id ) {
	$meta = wp_get_attachment_metadata( $attachment_id );
	return array(
		'id'          => (int) $attachment_id,
		'url'         => wp_get_attachment_url( $attachment_id ),
		'width'       => isset( $meta['width'] ) ? (int) $meta['width'] : null,
		'height'      => isset( $meta['height'] ) ? (int) $meta['height'] : null,
		'orientation' => isset( $meta['image_meta']['orientation'] ) ? (int) $meta['image_meta']['orientation'] : null,
		'rotated'     => ! empty( $meta['original_image'] ),
	);
};

$fair_e2e_result = array();
$fair_e2e_suffix = wp_generate_password( 6, false );

switch ( $fair_e2e_images_action ) {
	case 'png':
		$width  = (int) $fair_e2e_images_args[0];
		$height = (int) $fair_e2e_images_args[1];
		$image  = imagecreatetruecolor( $width, $height );
		imagefill( $image, 0, 0, imagecolorallocate( $image, 90, 160, 90 ) );
		ob_start();
		imagepng( $image );
		$fair_e2e_result = $fair_e2e_describe( $fair_e2e_attach( "e2e-event-image-{$fair_e2e_suffix}.png", ob_get_clean(), 'image/png' ) );
		break;

	case 'jpeg-rotated':
		$bytes           = $fair_e2e_jpeg( (int) $fair_e2e_images_args[0], (int) $fair_e2e_images_args[1], 6 );
		$fair_e2e_result = $fair_e2e_describe( $fair_e2e_attach( "e2e-event-image-rotated-{$fair_e2e_suffix}.jpg", $bytes, 'image/jpeg' ) );
		break;

	case 'jpeg-unrotated':
		$width         = (int) $fair_e2e_images_args[0];
		$height        = (int) $fair_e2e_images_args[1];
		$bytes         = $fair_e2e_jpeg( $width, $height, 6 );
		$attachment_id = $fair_e2e_attach( "e2e-event-image-unrotated-{$fair_e2e_suffix}.jpg", $bytes, 'image/jpeg', false );
		wp_update_attachment_metadata(
			$attachment_id,
			array(
				'width'      => $width,
				'height'     => $height,
				'file'       => _wp_relative_upload_path( get_attached_file( $attachment_id ) ),
				'sizes'      => array(),
				'image_meta' => array( 'orientation' => '6' ),
			)
		);
		$fair_e2e_result = $fair_e2e_describe( $attachment_id );
		break;

	case 'pdf':
		$fair_e2e_result = $fair_e2e_describe( $fair_e2e_attach( "e2e-event-image-{$fair_e2e_suffix}.pdf", "%PDF-1.4\n%%EOF\n", 'application/pdf', false ) );
		break;

	case 'no-size':
		$attachment_id = $fair_e2e_attach( "e2e-event-image-nosize-{$fair_e2e_suffix}.png", 'not really a png', 'image/png', false );
		wp_update_attachment_metadata( $attachment_id, array( 'file' => _wp_relative_upload_path( get_attached_file( $attachment_id ) ) ) );
		$fair_e2e_result = $fair_e2e_describe( $attachment_id );
		break;

	case 'edit':
		$attachment_id = (int) $fair_e2e_images_args[0];
		$meta          = wp_get_attachment_metadata( $attachment_id );
		$meta['file']  = preg_replace( '/(\.[a-z]+)$/', '-e' . time() . '$1', $meta['file'] );
		$meta['width'] = (int) ( $meta['width'] / 2 );
		wp_update_attachment_metadata( $attachment_id, $meta );
		$fair_e2e_result = $fair_e2e_describe( $attachment_id );
		break;

	case 'trash':
	case 'restore':
		$attachment_id = (int) $fair_e2e_images_args[0];
		wp_update_post(
			array(
				'ID'          => $attachment_id,
				'post_status' => 'trash' === $fair_e2e_images_action ? 'trash' : 'inherit',
			)
		);
		$fair_e2e_result = array( 'status' => get_post_status( $attachment_id ) );
		break;

	case 'delete':
		$fair_e2e_result = array( 'deleted' => (bool) wp_delete_attachment( (int) $fair_e2e_images_args[0], true ) );
		break;

	case 'rows':
		global $wpdb;
		$fair_e2e_result = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT id, schedule_item_id, attachment_id, position, center_x, center_y, radius FROM %i WHERE event_date_id = %d ORDER BY schedule_item_id, position',
				$wpdb->prefix . 'fair_events_experimental_event_images',
				(int) $fair_e2e_images_args[0]
			),
			ARRAY_A
		);
		break;

	case 'cleanup':
		foreach ( $fair_e2e_images_args as $attachment_id ) {
			wp_delete_attachment( (int) $attachment_id, true );
		}
		$fair_e2e_result = array( 'ok' => true );
		break;

	default:
		WP_CLI::error( 'Unknown action: ' . $fair_e2e_images_action );
}

echo 'E2E_EVENT_IMAGES:' . wp_json_encode( $fair_e2e_result ) . "\n";
