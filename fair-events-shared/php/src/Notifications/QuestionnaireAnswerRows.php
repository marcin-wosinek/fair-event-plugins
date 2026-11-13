<?php
/**
 * Shared questionnaire-answer rows for notification emails.
 *
 * @package FairEventsShared
 */

namespace FairEventsShared\Notifications;

defined( 'WPINC' ) || die;

/**
 * Renders questionnaire answers as `<tr>` rows for the two-column answer
 * tables in Fair Audience and Fair Form emails (#2233).
 *
 * Never calls translation functions: answers carry their own question text,
 * so every plugin renders them identically without a text domain.
 */
class QuestionnaireAnswerRows {

	/**
	 * Render questionnaire answers as `<tr>` rows.
	 *
	 * Accepts both array-shaped answers (as produced by the REST request) and
	 * answer model objects (as returned by the repositories), reading
	 * `question_text`, `question_type` and `answer_value` from either, and
	 * keeps their order. Values that decode to a JSON array (such as
	 * `multiselect` answers) render as a comma-joined list. Empty text values
	 * still render their row. `file_upload` values are an attachment ID that
	 * resolves to a link labelled with the attachment title, or its filename
	 * when untitled; an answer whose attachment cannot be resolved is skipped
	 * rather than showing a stray ID.
	 *
	 * Question text and values are escaped here; callers pass raw answers.
	 *
	 * @param array $answers Answer arrays or answer model objects.
	 * @return string `<tr>...</tr>` markup, or '' when nothing renderable.
	 */
	public static function html( array $answers ): string {
		$rows = '';
		foreach ( $answers as $answer ) {
			$question_text = (string) self::field( $answer, 'question_text' );
			$question_type = (string) self::field( $answer, 'question_type' );
			$answer_value  = self::field( $answer, 'answer_value' );

			if ( 'file_upload' === $question_type ) {
				$value_html = self::attachment_link( $answer_value );
				if ( '' === $value_html ) {
					continue;
				}

				$rows .= self::row( esc_html( $question_text ), $value_html );
				continue;
			}

			$decoded = json_decode( (string) $answer_value, true );
			if ( is_array( $decoded ) ) {
				$answer_value = implode( ', ', $decoded );
			}

			$rows .= self::row( esc_html( $question_text ), esc_html( (string) $answer_value ) );
		}

		return $rows;
	}

	/**
	 * Render one label/value row in the answer-table style.
	 *
	 * Both arguments are HTML fragments that the caller has already escaped,
	 * so a value can carry markup such as a `mailto:` link.
	 *
	 * @param string $label_html Escaped label HTML.
	 * @param string $value_html Escaped value HTML.
	 * @return string One `<tr>...</tr>` row.
	 */
	public static function row( string $label_html, string $value_html ): string {
		return '<tr>
				<td style="padding: 8px 12px; border-bottom: 1px solid #eeeeee; font-weight: bold; vertical-align: top; width: 40%;">' . $label_html . '</td>
				<td style="padding: 8px 12px; border-bottom: 1px solid #eeeeee;">' . $value_html . '</td>
			</tr>';
	}

	/**
	 * Read one field from an array-shaped answer or an answer object.
	 *
	 * @param array|object $answer Answer.
	 * @param string       $name   Field name.
	 * @return mixed Field value, or '' when missing.
	 */
	private static function field( $answer, string $name ) {
		if ( is_object( $answer ) ) {
			return $answer->$name ?? '';
		}

		return is_array( $answer ) ? ( $answer[ $name ] ?? '' ) : '';
	}

	/**
	 * Resolve a file-upload answer to an escaped attachment link.
	 *
	 * @param mixed $answer_value Stored attachment ID.
	 * @return string Link HTML, or '' when the attachment cannot be resolved.
	 */
	private static function attachment_link( $answer_value ): string {
		if ( ! is_numeric( $answer_value ) ) {
			return '';
		}

		$attachment_id  = (int) $answer_value;
		$attachment_url = wp_get_attachment_url( $attachment_id );
		if ( ! $attachment_url ) {
			return '';
		}

		$label = get_the_title( $attachment_id );

		return '<a href="' . esc_url( $attachment_url ) . '" style="color: #0073aa;">'
			. esc_html( $label ? $label : basename( $attachment_url ) )
			. '</a>';
	}
}
