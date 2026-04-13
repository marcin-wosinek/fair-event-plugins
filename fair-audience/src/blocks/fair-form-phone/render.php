<?php
/**
 * Render callback for the Fair Form Phone question block
 *
 * @package FairAudience
 * @param array    $attributes Block attributes.
 * @param string   $content    Block content.
 * @param WP_Block $block      Block instance.
 * @return string Rendered block HTML.
 *
 * phpcs:disable WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound
 * Variables in block render templates are scoped to the template and don't need prefixing.
 */

defined( 'WPINC' ) || die;

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
		'class'                   => 'fair-form-question fair-form-question-phone',
		'data-fair-form-question' => '',
		'data-question-key'       => esc_attr( $question_key ),
		'data-question-text'      => esc_attr( $question_text ),
		'data-question-type'      => 'phone',
		'data-required'           => $required ? '1' : '0',
	)
);

$format_hint = __( 'Include country code with leading "+" (e.g. +49170...).', 'fair-audience' );
?>

<div <?php echo wp_kses_data( $wrapper_attributes ); ?>>
	<label for="<?php echo esc_attr( $input_id ); ?>">
		<?php echo esc_html( $question_text ); ?>
		<?php if ( $required ) : ?>
			<span class="required">*</span>
		<?php endif; ?>
	</label>
	<input
		type="tel"
		inputmode="tel"
		pattern="^\+[1-9][0-9]{6,14}$"
		title="<?php echo esc_attr( $format_hint ); ?>"
		id="<?php echo esc_attr( $input_id ); ?>"
		name="<?php echo esc_attr( 'fair_form_q_' . $question_key ); ?>"
		<?php if ( $required ) : ?>
			required
		<?php endif; ?>
		<?php if ( ! empty( $placeholder ) ) : ?>
			placeholder="<?php echo esc_attr( $placeholder ); ?>"
		<?php endif; ?>
	/>
</div>
