<?php
/**
 * Server-side rendering for Time Column Body block
 *
 * @package FairTimetable
 */

defined( 'WPINC' ) || die;

// Get wrapper attributes
$wrapper_attributes = get_block_wrapper_attributes([
    'class' => 'time-column-body-container',
]);
?>

<div <?php echo $wrapper_attributes; ?>>
    <?php echo $content; ?>
</div>
