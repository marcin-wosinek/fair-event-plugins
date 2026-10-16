<?php
/**
 * Placeholders of retired features in saved email content
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

defined( 'WPINC' ) || die;

/**
 * Removes placeholders whose feature no longer exists from email content.
 *
 * The participant photo upload page is gone (#1689), but saved custom mails,
 * scheduled messages and mailing drafts may still contain its
 * `{photo_upload_url}` placeholder. A link pointing at it is dropped
 * together with its text, and a bare occurrence is removed, so the message
 * sends cleanly without a dead link. No token is generated.
 */
class RetiredPlaceholders {

	/**
	 * Placeholder of the removed participant photo upload page.
	 */
	const PHOTO_UPLOAD = '{photo_upload_url}';

	/**
	 * Remove retired placeholders from email content.
	 *
	 * @param string $content Email content (HTML).
	 * @return string Content without retired placeholders.
	 */
	public static function strip( $content ) {
		$content = (string) $content;
		if ( false === strpos( $content, self::PHOTO_UPLOAD ) ) {
			return $content;
		}

		$content = preg_replace(
			'#<a\b[^>]*' . preg_quote( self::PHOTO_UPLOAD, '#' ) . '[^>]*>.*?</a>#is',
			'',
			$content
		);

		return str_replace( self::PHOTO_UPLOAD, '', (string) $content );
	}
}
