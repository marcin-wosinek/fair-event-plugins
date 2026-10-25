<?php
/**
 * Render callback for the Fair Form Multiselect question block
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

// Typed option blocks, or categories resolved on every render.
$options        = \FairForm\Services\QuestionOptions::resolve( $attributes, $block );
$has_no_choices = empty( $options ) && \FairForm\Services\QuestionOptions::is_category_source( $attributes );

// Generate unique ID for this input.
$input_id = 'fair-form-q-' . sanitize_title( $question_key ) . '-' . wp_unique_id();

$wrapper_attributes = get_block_wrapper_attributes(
	array(
		'class'                   => 'fair-form-question fair-form-question-multiselect',
		'data-fair-form-question' => '',
		'data-question-key'       => esc_attr( $question_key ),
		'data-question-text'      => esc_attr( $question_text ),
		'data-question-type'      => 'multiselect',
		'data-required'           => $required ? '1' : '0',
	)
);
?>

<div <?php echo wp_kses_data( $wrapper_attributes ); ?>>
	<label>
		<?php echo esc_html( $question_text ); ?>
		<?php if ( $required ) : ?>
			<span class="required">*</span>
		<?php endif; ?>
	</label>
	<fieldset id="<?php echo esc_attr( $input_id ); ?>" class="fair-form-checkbox-fieldset">
		<?php foreach ( $options as $option ) : ?>
			<label class="fair-form-checkbox-label">
				<input
					type="checkbox"
					name="<?php echo esc_attr( 'fair_form_q_' . $question_key ); ?>[]"
					value="<?php echo esc_attr( $option ); ?>"
				/>
				<?php echo esc_html( $option ); ?>
			</label>
		<?php endforeach; ?>
	</fieldset>
	<?php if ( $has_no_choices ) : ?>
		<p class="fair-form-question-empty"><?php echo esc_html__( 'There are no choices to pick from yet.', 'fair-form' ); ?></p>
	<?php endif; ?>
</div>
