<?php
/**
 * Render callback for the Fair Form Long Text question block
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
$rows          = (int) ( $attributes['rows'] ?? 4 );

// Skip rendering if no question text is set.
if ( empty( $question_text ) ) {
	return '';
}

// Generate unique ID for this input.
$input_id = 'fair-form-q-' . sanitize_title( $question_key ) . '-' . wp_unique_id();

$wrapper_attributes = get_block_wrapper_attributes(
	array(
		'class'                   => 'fair-form-question fair-form-question-long-text',
		'data-fair-form-question' => '',
		'data-question-key'       => esc_attr( $question_key ),
		'data-question-text'      => esc_attr( $question_text ),
		'data-question-type'      => 'long_text',
		'data-required'           => $required ? '1' : '0',
	)
);
?>

<div <?php echo wp_kses_data( $wrapper_attributes ); ?>>
	<label for="<?php echo esc_attr( $input_id ); ?>">
		<?php echo esc_html( $question_text ); ?>
		<?php if ( $required ) : ?>
			<span class="required">*</span>
		<?php endif; ?>
	</label>
	<textarea
		id="<?php echo esc_attr( $input_id ); ?>"
		name="<?php echo esc_attr( 'fair_form_q_' . $question_key ); ?>"
		rows="<?php echo esc_attr( $rows ); ?>"
		<?php if ( $required ) : ?>
			required
		<?php endif; ?>
		<?php if ( ! empty( $placeholder ) ) : ?>
			placeholder="<?php echo esc_attr( $placeholder ); ?>"
		<?php endif; ?>
	></textarea>
</div>
