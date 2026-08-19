package de.anzeigetafel.controllertestapp

import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.format.DateFormat
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import java.net.NetworkInterface
import java.util.Collections
import java.util.Date

/**
 * Diagnose-App zur Verifikation des "novasoft"-Installationswegs auf dem
 * NovaStar Taurus TB50. Zeigt Geräteinfos, IP-Adressen, die tatsächliche
 * Fenster-Auflösung (klärt 384x192 vs. 384x224) und einen Sekundenzähler
 * als Liveness-Beweis. Kein Netzwerkprotokoll, keine Fernsteuerung -- das
 * ist bewusst nur der erste Schritt, um den Installationsweg zu prüfen.
 */
class MainActivity : AppCompatActivity() {

    private val handler = Handler(Looper.getMainLooper())
    private lateinit var clockView: TextView
    private lateinit var resolutionView: TextView
    private var tickCount = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        hideSystemBars()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0B3D91"))
            setPadding(24, 24, 24, 24)
        }

        fun addLine(text: String, sizeSp: Float = 14f): TextView {
            val view = TextView(this@MainActivity).apply {
                this.text = text
                setTextColor(Color.WHITE)
                textSize = sizeSp
            }
            root.addView(view)
            return view
        }

        addLine("SCOREBOARD CONTROLLER TEST APP", 20f)
        addLine("Modell: ${Build.MANUFACTURER} ${Build.MODEL}")
        addLine("Android: ${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT})")
        addLine("IP-Adressen: ${localIpAddresses()}")
        resolutionView = addLine("Auflösung: wird ermittelt ...")

        clockView = TextView(this).apply {
            setTextColor(Color.YELLOW)
            textSize = 28f
        }
        root.addView(clockView)

        setContentView(root)

        root.post {
            resolutionView.text = "Fenster-Auflösung: ${root.width} x ${root.height} px"
        }

        startClockTicker()
    }

    private fun startClockTicker() {
        val tick = object : Runnable {
            override fun run() {
                tickCount++
                clockView.text = "Läuft seit ${tickCount}s - ${DateFormat.format("HH:mm:ss", Date())}"
                handler.postDelayed(this, 1000)
            }
        }
        handler.post(tick)
    }

    private fun localIpAddresses(): String {
        return try {
            val addresses = Collections.list(NetworkInterface.getNetworkInterfaces())
                .flatMap { Collections.list(it.inetAddresses) }
                .filter { !it.isLoopbackAddress && it.hostAddress?.contains(':') == false }
                .mapNotNull { it.hostAddress }
            if (addresses.isEmpty()) "keine gefunden" else addresses.joinToString(", ")
        } catch (e: Exception) {
            "Fehler: ${e.message}"
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    @Suppress("DEPRECATION")
    private fun hideSystemBars() {
        // Bewusst die ältere systemUiVisibility-API statt WindowInsetsController,
        // da der TB50 vermutlich ein älteres Android (ab 5.0 laut T-SDK-Doku)
        // fährt und diese API dort zuverlässiger funktioniert.
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            )
    }
}
