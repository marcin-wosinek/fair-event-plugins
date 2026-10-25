<?php
/**
 * Seed, report and clean up the media left behind by the removed Image
 * Templates bundle: a template attachment carrying the three template meta
 * keys and a generated image attachment.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/retired-image-templates-media.php seed
 *   wp eval-file wp-content/mu-plugins/scripts/retired-image-templates-media.php check <templateId> <generatedId>
 *   wp eval-file wp-content/mu-plugins/scripts/retired-image-templates-media.php cleanup <templateId> <generatedId>
 *
 * Prints a single `E2E_MEDIA:{json}` line.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

require_once ABSPATH . 'wp-admin/includes/image.php';

$media_mode = isset( $args[0] ) ? (string) $args[0] : '';
$media_ids  = array_map( 'intval', array_slice( $args, 1 ) );

$template_variables = array(
	array(
		'name' => 'title',
		'x'    => 10,
		'y'    => 20,
	),
);
$template_images    = array(
	array(
		'name'   => 'photo',
		'x'      => 0,
		'y'      => 0,
		'width'  => 1,
		'height' => 1,
	),
);

/**
 * Upload a 1×1 PNG and register it as an attachment.
 *
 * @param string $name File name.
 * @return int Attachment ID.
 */
$create_attachment = static function ( $name ) {
	// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode
	$png    = base64_decode( 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' );
	$upload = wp_upload_bits( $name, null, $png );
	if ( ! empty( $upload['error'] ) ) {
		WP_CLI::error( $upload['error'] );
	}
	$attachment_id = wp_insert_attachment(
		array(
			'post_mime_type' => 'image/png',
			'post_title'     => $name,
			'post_status'    => 'inherit',
		),
		$upload['file']
	);
	wp_update_attachment_metadata( $attachment_id, wp_generate_attachment_metadata( $attachment_id, $upload['file'] ) );
	return $attachment_id;
};

if ( 'seed' === $media_mode ) {
	$template_id = $create_attachment( 'e2e-retired-image-template.png' );
	update_post_meta( $template_id, '_fair_audience_image_template', '1' );
	update_post_meta( $template_id, '_fair_audience_template_variables', $template_variables );
	update_post_meta( $template_id, '_fair_audience_template_images', $template_images );
	$media_ids = array( $template_id, $create_attachment( 'e2e-retired-image-generated.png' ) );
}

if ( 'cleanup' === $media_mode ) {
	foreach ( $media_ids as $attachment_id ) {
		wp_delete_attachment( $attachment_id, true );
	}
}

$media_state = array();
foreach ( $media_ids as $attachment_id ) {
	$file          = get_attached_file( $attachment_id );
	$media_state[] = array(
		'id'         => $attachment_id,
		'exists'     => 'attachment' === get_post_type( $attachment_id ),
		'fileExists' => $file && file_exists( $file ),
		'isTemplate' => get_post_meta( $attachment_id, '_fair_audience_image_template', true ),
		'variables'  => get_post_meta( $attachment_id, '_fair_audience_template_variables', true ),
		'images'     => get_post_meta( $attachment_id, '_fair_audience_template_images', true ),
	);
}

echo 'E2E_MEDIA:' . wp_json_encode(
	array(
		'media'             => $media_state,
		'expectedVariables' => $template_variables,
		'expectedImages'    => $template_images,
	)
) . "\n";
