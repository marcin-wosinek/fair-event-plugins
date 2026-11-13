<?php
/**
 * Shared HTML framing for Fair Audience emails.
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

defined( 'WPINC' ) || die;

/**
 * Renders the table-based document and repeated presentation fragments that
 * EmailService messages share.
 *
 * Holds markup only: callers pass text that is already translated and
 * escaped, and HTML fragments they prepared explicitly. Nothing here
 * escapes, translates or sanitizes on the caller's behalf, so each message
 * keeps control of its own content (#2234). Inline styles are kept because
 * email clients strip <style> blocks.
 */
final class EmailLayout {

	/**
	 * Default header background.
	 */
	public const HEADER_COLOR = '#0073aa';

	/**
	 * Header background for failure notices.
	 */
	public const HEADER_COLOR_ALERT = '#b32d2e';

	/**
	 * Style of a standard 16px body paragraph.
	 */
	public const BODY_TEXT = 'margin: 0 0 20px 0; font-size: 16px;';

	/**
	 * Style of the muted sign-off paragraph that ends a message.
	 */
	public const SIGN_OFF = 'margin: 20px 0 0 0; font-size: 14px; color: #666666;';

	/**
	 * Style of a muted 14px note paragraph.
	 */
	public const NOTE = 'margin: 0 0 10px 0; font-size: 14px; color: #666666;';

	/**
	 * Render a complete email document.
	 *
	 * @param string $title_html   Escaped header title.
	 * @param string $content_html Prepared body HTML.
	 * @param string $footer_html  Prepared footer HTML; '' omits the footer row.
	 * @param string $header_color Header background color.
	 * @return string Full HTML document.
	 */
	public static function document( string $title_html, string $content_html, string $footer_html = '', string $header_color = self::HEADER_COLOR ): string {
		$footer_row = '';
		if ( '' !== $footer_html ) {
			$footer_row = '
					<!-- Footer -->
					<tr>
						<td style="background-color: #f8f8f8; padding: 20px 30px; border-radius: 0 0 8px 8px; text-align: center; font-size: 12px; color: #666666;">
							' . $footer_html . '
						</td>
					</tr>';
		}

		return '<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; font-size: 16px; line-height: 1.6; color: #333333; background-color: #f4f4f4;">
	<table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4;">
		<tr>
			<td align="center" style="padding: 20px 0;">
				<table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
					<!-- Header -->
					<tr>
						<td style="background-color: ' . $header_color . '; color: #ffffff; padding: 30px; border-radius: 8px 8px 0 0; text-align: center;">
							<h1 style="margin: 0; font-size: 24px; font-weight: bold;">' . $title_html . '</h1>
						</td>
					</tr>

					<!-- Content -->
					<tr>
						<td style="padding: 40px 30px;">
							' . $content_html . '
						</td>
					</tr>' . $footer_row . '
				</table>
			</td>
		</tr>
	</table>
</body>
</html>';
	}

	/**
	 * Render a styled paragraph.
	 *
	 * @param string $html  Prepared paragraph HTML.
	 * @param string $style Inline style.
	 * @return string Paragraph HTML.
	 */
	public static function paragraph( string $html, string $style = self::BODY_TEXT ): string {
		return '
							<p style="' . $style . '">
								' . $html . '
							</p>';
	}

	/**
	 * Render the centered primary call-to-action button.
	 *
	 * @param string $url        Escaped link destination.
	 * @param string $label_html Escaped button label.
	 * @return string Button paragraph HTML.
	 */
	public static function button( string $url, string $label_html ): string {
		return '
							<p style="margin: 0 0 30px 0; text-align: center;">
								<a href="' . $url . '" style="display: inline-block; background-color: #0073aa; color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 5px; font-weight: bold; font-size: 16px;">
									' . $label_html . '
								</a>
							</p>';
	}

	/**
	 * Render the copy-this-link fallback shown under a button.
	 *
	 * @param string $intro_html   Escaped "if the button doesn't work" text.
	 * @param string $url          Escaped link destination.
	 * @param bool   $more_follows Whether more footer content follows (adds spacing).
	 * @return string Footer HTML.
	 */
	public static function link_fallback( string $intro_html, string $url, bool $more_follows = false ): string {
		return self::paragraph( $intro_html, 'margin: 0 0 5px 0;' )
			. self::paragraph(
				'<a href="' . $url . '" style="color: #0073aa;">' . $url . '</a>',
				$more_follows ? 'margin: 0 0 15px 0; word-break: break-all;' : 'margin: 0; word-break: break-all;'
			);
	}

	/**
	 * Render label/value rows as a bordered details table.
	 *
	 * @param array<int, array{0: string, 1: string}> $rows Escaped label and value HTML pairs.
	 * @return string Table HTML.
	 */
	public static function details_table( array $rows ): string {
		$html = '
							<table style="width: 100%; border-collapse: collapse; margin: 0 0 20px 0;">';
		foreach ( $rows as $row ) {
			$html .= '
								<tr>
									<td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">' . $row[0] . '</td>
									<td style="padding: 8px 0; border-bottom: 1px solid #eee;">' . $row[1] . '</td>
								</tr>';
		}

		return $html . '
							</table>';
	}

	/**
	 * Wrap questionnaire answer rows in their bordered table.
	 *
	 * @param string $rows_html Prepared answer rows.
	 * @param string $margin    Table margin.
	 * @return string Table HTML.
	 */
	public static function answers_table( string $rows_html, string $margin = '0 0 20px 0' ): string {
		return '
							<table width="100%" cellpadding="0" cellspacing="0" style="margin: ' . $margin . '; border: 1px solid #eeeeee; border-radius: 4px;">
								' . $rows_html . '
							</table>';
	}

	/**
	 * Render a compact two-line footer: a prompt, then one link.
	 *
	 * @param string $prompt_html Escaped prompt text.
	 * @param string $url         Escaped link destination.
	 * @param string $link_html   Escaped link text.
	 * @return string Footer HTML.
	 */
	public static function footer_link( string $prompt_html, string $url, string $link_html ): string {
		return '<p style="margin: 0 0 5px 0;">' . $prompt_html . '</p>
							<p style="margin: 0;"><a href="' . $url . '" style="color: #0073aa;">' . $link_html . '</a></p>';
	}
}
