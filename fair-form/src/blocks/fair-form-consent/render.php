<?php
/**
 * Render callback for the Fair Form Consent question block
 *
 * @package FairForm
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

// Skip rendering if no question text is set.
if ( empty( $question_text ) ) {
	return '';
}

// Generate unique ID for this input.
$input_id = 'fair-form-q-' . sanitize_title( $question_key ) . '-' . wp_unique_id();

$wrapper_attributes = get_block_wrapper_attributes(
	array(
		'class'                   => 'fair-form-question fair-form-question-consent',
		'data-fair-form-question' => '',
		'data-question-key'       => esc_attr( $question_key ),
		'data-question-text'      => esc_attr( $question_text ),
		'data-question-type'      => 'checkbox',
		'data-required'           => $required ? '1' : '0',
	)
);
?>

<div <?php echo wp_kses_data( $wrapper_attributes ); ?>>
	<label for="<?php echo esc_attr( $input_id ); ?>">
		<input
			type="checkbox"
			id="<?php echo esc_attr( $input_id ); ?>"
			name="<?php echo esc_attr( 'fair_form_q_' . $question_key ); ?>"
			value="1"
			<?php if ( $required ) : ?>
				required
			<?php endif; ?>
		/>
		<?php echo esc_html( $question_text ); ?>
		<?php if ( $required ) : ?>
			<span class="required">*</span>
		<?php endif; ?>
	</label>
</div>
