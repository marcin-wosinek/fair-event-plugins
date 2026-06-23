<?php
/**
 * Render callback for the Fair Form Conditional block
 *
 * @package FairForm
 * @param array    $attributes Block attributes.
 * @param string   $content    Rendered inner blocks HTML.
 * @param WP_Block $block      Block instance.
 * @return string Rendered block HTML.
 *
 * phpcs:disable WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound
 * Variables in block render templates are scoped to the template and don't need prefixing.
 */

defined( 'WPINC' ) || die;

$condition_source            = $attributes['conditionSource'] ?? 'question';
$condition_question_key      = $attributes['conditionQuestionKey'] ?? '';
$condition_operator          = $attributes['conditionOperator'] ?? 'equals';
$condition_value             = $attributes['conditionValue'] ?? '';
$condition_option_short_name = $attributes['conditionOptionShortName'] ?? '';

// Don't render if the controlling reference is missing for the active source:
// a question key for the question source, or an option short name for the
// event-option source.
if ( 'eventOption' === $condition_source ) {
	if ( empty( $condition_option_short_name ) ) {
		return '';
	}
} elseif ( empty( $condition_question_key ) ) {
	return '';
}

$wrapper_attributes = get_block_wrapper_attributes(
	array(
		'class'                            => 'fair-form-conditional',
		'data-fair-form-conditional'       => '',
		'data-condition-source'            => esc_attr( $condition_source ),
		'data-condition-question-key'      => esc_attr( $condition_question_key ),
		'data-condition-operator'          => esc_attr( $condition_operator ),
		'data-condition-value'             => esc_attr( $condition_value ),
		'data-condition-option-short-name' => esc_attr( $condition_option_short_name ),
	)
);
?>

<div <?php echo wp_kses_data( $wrapper_attributes ); ?>>
	<?php echo $content; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- Inner blocks content is already escaped by WordPress. ?>
</div>
