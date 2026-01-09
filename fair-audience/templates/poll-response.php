<?php
/**
 * Poll Response Template
 *
 * @package FairAudience
 */

defined( 'WPINC' ) || die;

get_header();
?>

<div id="fair-audience-poll-root" data-access-key="<?php echo esc_attr( $_GET['poll_key'] ); ?>"></div>

<?php
// Enqueue the poll response script.
$asset_file = include FAIR_AUDIENCE_PLUGIN_DIR . 'build/public/poll-response/index.asset.php';

wp_enqueue_script(
	'fair-audience-poll-response',
	FAIR_AUDIENCE_PLUGIN_URL . 'build/public/poll-response/index.js',
	$asset_file['dependencies'],
	$asset_file['version'],
	true
);

get_footer();
?>
