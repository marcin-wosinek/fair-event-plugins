<?php
/**
 * Render callback for the Fair Form Select One question block
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
		'class'                   => 'fair-form-question fair-form-question-select-one',
		'data-fair-form-question' => '',
		'data-question-key'       => esc_attr( $question_key ),
		'data-question-text'      => esc_attr( $question_text ),
		'data-question-type'      => 'select',
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
	<select
		id="<?php echo esc_attr( $input_id ); ?>"
		name="<?php echo esc_attr( 'fair_form_q_' . $question_key ); ?>"
		<?php if ( $required ) : ?>
			required
		<?php endif; ?>
	>
		<option value=""><?php echo esc_html__( 'Select an option...', 'fair-form' ); ?></option>
		<?php foreach ( $options as $option ) : ?>
			<option value="<?php echo esc_attr( $option ); ?>">
				<?php echo esc_html( $option ); ?>
			</option>
		<?php endforeach; ?>
	</select>
	<?php if ( $has_no_choices ) : ?>
		<p class="fair-form-question-empty"><?php echo esc_html__( 'There are no choices to pick from yet.', 'fair-form' ); ?></p>
	<?php endif; ?>
</div>
