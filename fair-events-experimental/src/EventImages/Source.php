<?php
/**
 * Source metadata of an image attachment.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\EventImages;

defined( 'WPINC' ) || die;

/**
 * Reads what a consumer needs to crop an attachment: its full-size URL and
 * its oriented pixel dimensions.
 *
 * WordPress rotates JPEG uploads by their EXIF orientation and then stores
 * orientation 1, so the stored width and height are usually already
 * oriented. When it could not rotate (no image editor, or an image added
 * outside the uploader), the file keeps its EXIF orientation and browsers
 * display it turned; for orientations 5–8 the displayed width and height are
 * then the stored ones swapped. Circles are always relative to the image as
 * displayed, and the admin preview shows the same URL, so it matches.
 */
class Source {

	/**
	 * Image types a circle can be drawn on and every browser displays.
	 */
	public const MIME_TYPES = array( 'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif' );

	/**
	 * Describe an attachment, or explain why it cannot be used.
	 *
	 * @param int $attachment_id Attachment ID.
	 * @return array{ok: bool, reason?: string, url?: string, width?: int|null, height?: int|null, revision?: string, alt?: string|null, credit?: string|null, title?: string}
	 */
	public static function describe( $attachment_id ) {
		$post = get_post( (int) $attachment_id );
		if ( ! $post || 'attachment' !== $post->post_type ) {
			return array(
				'ok'     => false,
				'reason' => 'missing',
			);
		}

		if ( 'trash' === $post->post_status ) {
			return array(
				'ok'     => false,
				'reason' => 'trashed',
			);
		}

		if ( ! in_array( (string) $post->post_mime_type, self::MIME_TYPES, true ) ) {
			return array(
				'ok'     => false,
				'reason' => 'not_image',
			);
		}

		$url = wp_get_attachment_url( $post->ID );
		if ( ! $url ) {
			return array(
				'ok'     => false,
				'reason' => 'missing_file',
			);
		}

		$meta       = wp_get_attachment_metadata( $post->ID );
		$meta       = is_array( $meta ) ? $meta : array();
		$width      = isset( $meta['width'] ) ? (int) $meta['width'] : 0;
		$height     = isset( $meta['height'] ) ? (int) $meta['height'] : 0;
		$image_meta = isset( $meta['image_meta'] ) && is_array( $meta['image_meta'] ) ? $meta['image_meta'] : array();
		$exif       = isset( $image_meta['orientation'] ) ? (int) $image_meta['orientation'] : 1;

		if ( $width > 0 && $height > 0 && $exif >= 5 && $exif <= 8 ) {
			list( $width, $height ) = array( $height, $width );
		}

		$known = $width > 0 && $height > 0;
		$alt   = trim( (string) get_post_meta( $post->ID, '_wp_attachment_image_alt', true ) );
		$cred  = isset( $image_meta['credit'] ) ? trim( (string) $image_meta['credit'] ) : '';

		return array(
			'ok'       => true,
			'url'      => $url,
			'width'    => $known ? $width : null,
			'height'   => $known ? $height : null,
			'revision' => self::revision( $meta, $url, $exif ),
			'alt'      => '' === $alt ? null : $alt,
			'credit'   => '' === $cred ? null : $cred,
			'title'    => get_the_title( $post ),
		);
	}

	/**
	 * Fingerprint of the displayed source: changes when the image is edited
	 * in place (cropped, rotated, scaled) or its file is replaced.
	 *
	 * @param array  $meta Attachment metadata.
	 * @param string $url  Full-size URL.
	 * @param int    $exif EXIF orientation.
	 * @return string
	 */
	private static function revision( array $meta, $url, $exif ) {
		return substr(
			hash(
				'sha256',
				implode(
					'|',
					array(
						isset( $meta['file'] ) ? (string) $meta['file'] : '',
						$url,
						isset( $meta['width'] ) ? (int) $meta['width'] : 0,
						isset( $meta['height'] ) ? (int) $meta['height'] : 0,
						(int) $exif,
					)
				)
			),
			0,
			16
		);
	}
}
