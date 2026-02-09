<?php
/**
 * SVG Upload Hooks
 *
 * @package FairAudience
 */

namespace FairAudience\Hooks;

defined( 'WPINC' ) || die;

/**
 * Enable SVG uploads for admins with sanitization.
 */
class SvgUploadHooks {

	/**
	 * Initialize hooks.
	 */
	public static function init() {
		add_filter( 'upload_mimes', array( static::class, 'allow_svg_upload' ) );
		add_filter( 'wp_handle_upload_prefilter', array( static::class, 'sanitize_svg_upload' ) );
		add_filter( 'wp_check_filetype_and_ext', array( static::class, 'fix_svg_mime_type' ), 10, 5 );
	}

	/**
	 * Add SVG to allowed upload MIME types for admins.
	 *
	 * @param array $mimes Allowed MIME types.
	 * @return array Modified MIME types.
	 */
	public static function allow_svg_upload( $mimes ) {
		if ( current_user_can( 'manage_options' ) ) {
			$mimes['svg'] = 'image/svg+xml';
		}
		return $mimes;
	}

	/**
	 * Sanitize SVG uploads by stripping dangerous elements and attributes.
	 *
	 * @param array $file File data from upload.
	 * @return array Modified file data.
	 */
	public static function sanitize_svg_upload( $file ) {
		if ( 'image/svg+xml' !== $file['type'] ) {
			return $file;
		}

		if ( ! current_user_can( 'manage_options' ) ) {
			$file['error'] = __( 'You are not allowed to upload SVG files.', 'fair-audience' );
			return $file;
		}

		$svg_content = file_get_contents( $file['tmp_name'] );
		if ( false === $svg_content ) {
			$file['error'] = __( 'Could not read SVG file.', 'fair-audience' );
			return $file;
		}

		$sanitized = self::sanitize_svg( $svg_content );
		if ( false === $sanitized ) {
			$file['error'] = __( 'Invalid SVG file.', 'fair-audience' );
			return $file;
		}

		file_put_contents( $file['tmp_name'], $sanitized );

		return $file;
	}

	/**
	 * Sanitize SVG content by removing script elements and on* attributes.
	 *
	 * @param string $svg_content Raw SVG content.
	 * @return string|false Sanitized SVG content or false on failure.
	 */
	private static function sanitize_svg( $svg_content ) {
		$use_errors = libxml_use_internal_errors( true );

		$doc = new \DOMDocument();
		if ( ! $doc->loadXML( $svg_content ) ) {
			libxml_clear_errors();
			libxml_use_internal_errors( $use_errors );
			return false;
		}

		// Remove <script> elements.
		$scripts = $doc->getElementsByTagName( 'script' );
		while ( $scripts->length > 0 ) {
			$scripts->item( 0 )->parentNode->removeChild( $scripts->item( 0 ) );
		}

		// Remove on* event attributes from all elements.
		$xpath = new \DOMXPath( $doc );
		$nodes = $xpath->query( '//*' );
		foreach ( $nodes as $node ) {
			$attributes_to_remove = array();
			foreach ( $node->attributes as $attr ) {
				if ( preg_match( '/^on/i', $attr->name ) ) {
					$attributes_to_remove[] = $attr->name;
				}
			}
			foreach ( $attributes_to_remove as $attr_name ) {
				$node->removeAttribute( $attr_name );
			}
		}

		$result = $doc->saveXML();
		libxml_clear_errors();
		libxml_use_internal_errors( $use_errors );

		return $result;
	}

	/**
	 * Fix WordPress SVG MIME type detection.
	 *
	 * @param array       $data     File data.
	 * @param string      $file     Full path to the file.
	 * @param string      $filename The name of the file.
	 * @param string[]    $mimes    Array of MIME types keyed by extension.
	 * @param string|bool $real_mime The actual MIME type or false.
	 * @return array Modified file data.
	 */
	public static function fix_svg_mime_type( $data, $file, $filename, $mimes, $real_mime = false ) {
		if ( ! current_user_can( 'manage_options' ) ) {
			return $data;
		}

		$ext = pathinfo( $filename, PATHINFO_EXTENSION );
		if ( 'svg' === strtolower( $ext ) ) {
			$data['ext']             = 'svg';
			$data['type']            = 'image/svg+xml';
			$data['proper_filename'] = $filename;
		}

		return $data;
	}
}
