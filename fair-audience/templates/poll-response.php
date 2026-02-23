<?php
/**
 * Poll Response Template
 *
 * @package FairAudience
 */

defined( 'WPINC' ) || die;

$site_name = wp_specialchars_decode( get_option( 'blogname' ), ENT_QUOTES );
?>
<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title><?php echo esc_html( $site_name ); ?></title>
	<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>

<div id="fair-audience-poll-root" data-access-key="<?php echo esc_attr( $_GET['poll_key'] ); ?>"></div>

<?php
// Enqueue the poll response script and styles.
$asset_file = include FAIR_AUDIENCE_PLUGIN_DIR . 'build/public/poll-response/index.asset.php';

wp_enqueue_script(
	'fair-audience-poll-response',
	FAIR_AUDIENCE_PLUGIN_URL . 'build/public/poll-response/index.js',
	$asset_file['dependencies'],
	$asset_file['version'],
	true
);

wp_enqueue_style(
	'fair-audience-poll-response',
	FAIR_AUDIENCE_PLUGIN_URL . 'build/public/poll-response/style-index.css',
	array(),
	$asset_file['version']
);

wp_footer();
?>
</body>
</html>
