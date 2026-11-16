<?php
/**
 * Shared HTML framing for Fair Event Plugins emails.
 *
 * @package FairEventsShared
 */

namespace FairEventsShared\Notifications;

defined( 'WPINC' ) || die;

/**
 * Renders the common email document and the repeated presentation elements
 * every plugin's emails share (#2322): header, paragraphs, buttons, link
 * fallbacks, detail and answer tables, lists and footers.
 *
 * Holds markup only. Callers pass text that is already translated and
 * escaped for its context, and HTML fragments they prepared explicitly.
 * Nothing here escapes, translates or sanitizes on the caller's behalf, so
 * each message keeps control of its own content and text domain.
 *
 * Styles are inline because email clients strip `<style>` blocks. The card
 * is fluid up to 600px, so it fits phone screens without horizontal
 * scrolling, and long words, URLs and translated labels wrap instead of
 * widening it. Layout tables carry `role="presentation"`; detail and answer
 * tables stay data tables.
 *
 * Each plugin bundles its own copy of this package and only the newest one
 * loads, so never change an existing method's signature or output contract
 * for older callers; add constants and methods instead.
 */
final class EmailLayout {

	/**
	 * Default header background, also the link and button color.
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
	 * Style of the bold label introducing a list or table.
	 */
	public const SECTION_LABEL = 'margin: 0 0 8px 0; font-size: 16px; font-weight: bold;';

	/**
	 * Style of a single footer line.
	 */
	public const FOOTER_TEXT = 'margin: 0;';

	/**
	 * Wrapping rules that keep long words and URLs inside the card.
	 */
	private const WRAP = 'overflow-wrap: break-word; word-wrap: break-word; word-break: break-word;';

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
						<td style="background-color: #f8f8f8; padding: 20px; border-radius: 0 0 8px 8px; text-align: center; font-size: 12px; color: #666666; ' . self::WRAP . '">
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
<body style="margin: 0; padding: 0; width: 100%; font-family: Arial, sans-serif; font-size: 16px; line-height: 1.6; color: #333333; background-color: #f4f4f4; -webkit-text-size-adjust: 100%;">
	<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f4f4f4;">
		<tr>
			<td align="center" style="padding: 20px 10px;">
				<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->
				<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: 600px; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
					<!-- Header -->
					<tr>
						<td style="background-color: ' . $header_color . '; color: #ffffff; padding: 30px 20px; border-radius: 8px 8px 0 0; text-align: center; ' . self::WRAP . '">
							<h1 style="margin: 0; font-size: 24px; line-height: 1.3; font-weight: bold; color: #ffffff;">' . $title_html . '</h1>
						</td>
					</tr>

					<!-- Content -->
					<tr>
						<td style="padding: 30px 20px; text-align: left; ' . self::WRAP . '">
							' . $content_html . '
						</td>
					</tr>' . $footer_row . '
				</table>
				<!--[if mso]></td></tr></table><![endif]-->
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
	 * Render a section heading inside the content, such as a day in a
	 * weekly events list.
	 *
	 * @param string $html Escaped heading text.
	 * @return string Heading HTML.
	 */
	public static function heading( string $html ): string {
		return '<h3 style="margin: 20px 0 10px 0; font-size: 16px; line-height: 1.4;">' . $html . '</h3>';
	}

	/**
	 * Render a block of prepared rich content, such as an organizer's
	 * message or author-written mail, keeping its own formatting.
	 *
	 * @param string $html Sanitized HTML.
	 * @return string Block HTML.
	 */
	public static function content_block( string $html ): string {
		return '
							<div style="margin: 0 0 20px 0; font-size: 16px;">
								' . $html . '
							</div>';
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
								<a href="' . $url . '" style="display: inline-block; max-width: 100%; box-sizing: border-box; background-color: ' . self::HEADER_COLOR . '; color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 5px; font-weight: bold; font-size: 16px; line-height: 1.4;">
									' . $label_html . '
								</a>
							</p>';
	}

	/**
	 * Render an inline text link in the common link color.
	 *
	 * @param string $url        Escaped link destination.
	 * @param string $label_html Escaped link text.
	 * @return string Link HTML.
	 */
	public static function text_link( string $url, string $label_html ): string {
		return '<a href="' . $url . '" style="color: ' . self::HEADER_COLOR . ';">' . $label_html . '</a>';
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
				'<a href="' . $url . '" style="color: ' . self::HEADER_COLOR . '; word-break: break-all;">' . $url . '</a>',
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
							<table width="100%" cellpadding="0" cellspacing="0" style="width: 100%; border-collapse: collapse; margin: 0 0 20px 0;">';
		foreach ( $rows as $row ) {
			$html .= '
								<tr>
									<td style="padding: 8px 12px 8px 0; border-bottom: 1px solid #eeeeee; font-weight: bold; vertical-align: top;">' . $row[0] . '</td>
									<td style="padding: 8px 0; border-bottom: 1px solid #eeeeee; vertical-align: top;">' . $row[1] . '</td>
								</tr>';
		}

		return $html . '
							</table>';
	}

	/**
	 * Wrap questionnaire answer rows in their bordered table.
	 *
	 * @param string $rows_html Prepared answer rows, e.g. from QuestionnaireAnswerRows::html().
	 * @param string $margin    Table margin.
	 * @return string Table HTML.
	 */
	public static function answers_table( string $rows_html, string $margin = '0 0 20px 0' ): string {
		return '
							<table width="100%" cellpadding="0" cellspacing="0" style="width: 100%; table-layout: fixed; margin: ' . $margin . '; border: 1px solid #eeeeee; border-radius: 4px;">
								' . $rows_html . '
							</table>';
	}

	/**
	 * Render a bulleted list.
	 *
	 * @param string[] $items_html Escaped item HTML.
	 * @return string List HTML, or '' when there are no items.
	 */
	public static function item_list( array $items_html ): string {
		if ( empty( $items_html ) ) {
			return '';
		}

		$items = '';
		foreach ( $items_html as $item_html ) {
			$items .= '<li style="padding: 4px 0;">' . $item_html . '</li>';
		}

		return '
							<ul style="margin: 0 0 20px 20px; padding: 0;">' . $items . '</ul>';
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
							<p style="margin: 0;">' . self::text_link( $url, $link_html ) . '</p>';
	}
}
