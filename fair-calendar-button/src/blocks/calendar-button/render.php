<?php

namespace FairCalendarButton\Core;

defined( 'WPINC' ) || die;

/**
 * Render callback for the calendar button block
 *
 * @package FairCalendarButton
 * @param  array $attributes Block attributes
 * @param  string $content Block content
 * @param  WP_Block $block Block instance
 * @return string Rendered block HTML
 */

// Extract attributes with defaults.
$start       = $attributes['start'] ?? '';
$end         = $attributes['end'] ?? '';
$all_day     = $attributes['allDay'] ?? false;
$description = $attributes['description'] ?? '';
$location        = $attributes['location'] ?? '';
$recurring       = $attributes['recurring'] ?? false;
$rrule           = $attributes['rRule'] ?? '';
$exception_dates = $attributes['exceptionDates'] ?? array();

// Generate EXDATE string from exception dates
$exdate_string = '';
if (!empty($exception_dates) && is_array($exception_dates)) {
	$formatted_dates = array();
	foreach ($exception_dates as $date) {
		if (is_string($date) && !empty($date)) {
			// Format date from YYYY-MM-DD to YYYYMMDD
			$formatted_date = str_replace('-', '', $date);
			if (preg_match('/^\d{8}$/', $formatted_date)) {
				$formatted_dates[] = $formatted_date;
			}
		}
	}
	if (!empty($formatted_dates)) {
		$exdate_string = 'EXDATE:' . implode(',', $formatted_dates);
	}
}

// Get current page/post data.
$current_url   = get_permalink();
$current_title = get_the_title();

// Build data attributes for JavaScript (including URL functionality).
$data_attributes = sprintf(
	'data-start="%s" data-end="%s" data-all-day="%s" data-description="%s" data-location="%s" data-title="%s" data-recurring="%s" data-rrule="%s" data-exdate="%s" data-exception-dates="%s" data-url="%s"',
	esc_attr( $start ),
	esc_attr( $end ),
	$all_day ? 'true' : 'false',
	esc_attr( $description ),
	esc_attr( $location ),
	esc_attr( $current_title ),
	$recurring ? 'true' : 'false',
	esc_attr( $rrule ),
	esc_attr( $exdate_string ),
	esc_attr( json_encode( $exception_dates ) ),
	esc_attr( $current_url )
);

// Add data attributes to the button within the content.
$content_with_attributes = preg_replace(
	'/(<a[^>]*class="[^"]*wp-block-button__link[^"]*"[^>]*)(>)/',
	'$1 ' . $data_attributes . '$2',
	$content
);
?>

<div <?php echo wp_kses_data( get_block_wrapper_attributes() ); ?>>
	<?php echo wp_kses_post( $content_with_attributes ); ?>
</div>
