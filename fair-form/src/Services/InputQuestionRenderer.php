<?php
/**
 * Input Question Renderer
 *
 * @package FairForm
 */

namespace FairForm\Services;

defined( 'WPINC' ) || die;

/**
 * Public markup of the single-input questions: Date, Date & Time, Email and
 * Short Text (#2235).
 *
 * Each block's render.php passes its fixed configuration. The native input
 * type is kept apart from the question's data type, which the shared
 * frontend validation and the submission pipeline read: Date & Time renders
 * a `datetime-local` input for the `datetime` type, and Short Text a `text`
 * input for the `short_text` type.
 */
class InputQuestionRenderer {

	/**
	 * Render a single-input question.
	 *
	 * Must run inside a block render, since the wrapper comes from
	 * get_block_wrapper_attributes().
	 *
	 * @param array  $attributes    Block attributes.
	 * @param string $question_type Data type in `data-question-type`.
	 * @param string $input_type    Native type of the input element.
	 * @param string $class_name    Wrapper class naming the question type.
	 * @return string Escaped HTML, or '' when the question has no text.
	 */
	public static function render( array $attributes, $question_type, $input_type, $class_name ) {
		$question_text = $attributes['questionText'] ?? '';
		$question_key  = $attributes['questionKey'] ?? '';
		$required      = ! empty( $attributes['required'] );
		$placeholder   = $attributes['placeholder'] ?? '';

		// Skip rendering if no question text is set.
		if ( empty( $question_text ) ) {
			return '';
		}

		// Generate unique ID for this input.
		$input_id = 'fair-form-q-' . sanitize_title( $question_key ) . '-' . wp_unique_id();

		$wrapper_attributes = get_block_wrapper_attributes(
			array(
				'class'                   => 'fair-form-question ' . $class_name,
				'data-fair-form-question' => '',
				'data-question-key'       => esc_attr( $question_key ),
				'data-question-text'      => esc_attr( $question_text ),
				'data-question-type'      => $question_type,
				'data-required'           => $required ? '1' : '0',
			)
		);

		$input_attributes = sprintf(
			'type="%s" id="%s" name="%s"',
			esc_attr( $input_type ),
			esc_attr( $input_id ),
			esc_attr( 'fair_form_q_' . $question_key )
		);
		if ( $required ) {
			$input_attributes .= ' required';
		}
		if ( ! empty( $placeholder ) ) {
			$input_attributes .= sprintf( ' placeholder="%s"', esc_attr( $placeholder ) );
		}

		return sprintf(
			'<div %1$s><label for="%2$s">%3$s%4$s</label><input %5$s /></div>',
			wp_kses_data( $wrapper_attributes ),
			esc_attr( $input_id ),
			esc_html( $question_text ),
			$required ? ' <span class="required">*</span>' : '',
			$input_attributes
		);
	}
}
