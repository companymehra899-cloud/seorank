(function () {
  "use strict";

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  function markActiveNav() {
    var path = window.location.pathname.replace(/\/$/, "/index.html");
    var links = document.querySelectorAll(".nav a, .footer a");
    links.forEach(function (link) {
      var href = link.getAttribute("href");
      if (!href || href.charAt(0) === "#" || href.indexOf("://") > -1) return;
      var normalized = href.replace(/\/$/, "/index.html");
      if (normalized === path || (normalized !== "/index.html" && path.indexOf(normalized) === 0)) {
        link.classList.add("active");
      }
    });
  }

  function initMenu() {
    var toggle = document.getElementById("menuToggle");
    var nav = document.getElementById("nav");
    if (!toggle || !nav) return;

    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
    });

    document.querySelectorAll(".nav > li.has-mega > a").forEach(function (parent) {
      parent.addEventListener("click", function (event) {
        if (window.innerWidth > 980) return;
        var li = parent.parentElement;
        if (!li.classList.contains("open")) {
          event.preventDefault();
          li.classList.add("open");
        }
      });
    });
  }

  function initTabs() {
    document.querySelectorAll("[data-tabs]").forEach(function (group) {
      var buttons = group.querySelectorAll(".tab");
      var scope = document.querySelector(group.getAttribute("data-tabs"));
      if (!scope) return;
      buttons.forEach(function (button) {
        button.addEventListener("click", function () {
          buttons.forEach(function (b) { b.classList.remove("active"); });
          button.classList.add("active");
          scope.querySelectorAll(".panel").forEach(function (panel) {
            panel.classList.toggle("active", panel.id === button.getAttribute("data-target"));
          });
        });
      });
    });
  }

  function initPricingToggle() {
    document.querySelectorAll("[data-price-toggle]").forEach(function (wrap) {
      var buttons = wrap.querySelectorAll("button");
      var root = document.querySelector(wrap.getAttribute("data-price-toggle"));
      if (!root) return;
      buttons.forEach(function (button) {
        button.addEventListener("click", function () {
          buttons.forEach(function (b) { b.classList.remove("on"); });
          button.classList.add("on");
          var period = button.getAttribute("data-period");
          root.querySelectorAll("[data-monthly]").forEach(function (el) {
            el.textContent = period === "annual" ? el.getAttribute("data-annual") : el.getAttribute("data-monthly");
          });
          root.querySelectorAll("[data-strike]").forEach(function (el) {
            el.style.display = period === "annual" ? "inline" : "none";
          });
          root.querySelectorAll("[data-period-note]").forEach(function (el) {
            el.textContent = period === "annual" ? "billed annually" : "billed monthly";
          });
        });
      });
    });
  }

  function initSlider() {
    document.querySelectorAll("[data-slider]").forEach(function (root) {
      var slides = root.querySelectorAll(".slide");
      var dots = root.querySelectorAll(".dot-btn");
      if (!slides.length) return;
      var index = 0;
      function show(next) {
        index = (next + slides.length) % slides.length;
        slides.forEach(function (slide, i) { slide.style.display = i === index ? "block" : "none"; });
        dots.forEach(function (dot, i) { dot.classList.toggle("on", i === index); });
      }
      dots.forEach(function (dot, i) { dot.addEventListener("click", function () { show(i); }); });
      show(0);
      if (slides.length > 1) setInterval(function () { show(index + 1); }, 7000);
    });
  }

  function alertBox(form, message, isError) {
    var box = form.querySelector(".alert");
    if (!box) {
      box = document.createElement("div");
      box.className = "alert";
      form.appendChild(box);
    }
    box.textContent = message;
    box.style.display = "block";
    box.classList.toggle("err", Boolean(isError));
  }

  function initForms() {
    document.querySelectorAll("form[data-api]").forEach(function (form) {
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        var endpoint = form.getAttribute("data-api");
        var payload = {};
        new FormData(form).forEach(function (value, key) { payload[key] = value; });
        var submit = form.querySelector("button[type=submit]");
        if (submit) submit.disabled = true;

        fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        })
          .then(function (response) {
            return response.json().then(function (data) { return { ok: response.ok, data: data }; });
          })
          .then(function (result) {
            alertBox(form, result.data.message || result.data.error || "Request completed.", !result.ok);
            if (result.ok) form.reset();
          })
          .catch(function () {
            alertBox(form, "Network error. Please try again.", true);
          })
          .finally(function () {
            if (submit) submit.disabled = false;
          });
      });
    });
  }

  function initAuditForm() {
    var form = document.getElementById("auditForm");
    if (!form) return;
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var input = form.querySelector("input[name=url]");
      var results = document.getElementById("auditResults");
      var summary = document.getElementById("auditSummary");
      var submit = form.querySelector("button[type=submit]");
      if (!input.value.trim()) return;
      if (submit) submit.disabled = true;
      if (results) results.innerHTML = "<p class='muted'>Running audit preview...</p>";

      fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: input.value.trim() })
      })
        .then(function (response) { return response.json(); })
        .then(function (data) {
          if (data.error) throw new Error(data.error);
          if (summary) {
            summary.textContent = "SEO score " + data.score + "/100 for " + data.host + " (" + data.mode + ")";
            summary.style.display = "block";
          }
          if (results) {
            results.innerHTML = data.checks.map(function (check) {
              var icon = check.status === "pass" ? "<span class='ok-dot'>PASS</span>" : (check.status === "warn" ? "<span style='color:#f59e0b;font-weight:800'>WARN</span>" : "<span style='color:#ef4444;font-weight:800'>FAIL</span>");
              return "<tr><td>" + check.label + "</td><td>" + icon + "</td><td class='muted'>" + check.detail + "</td></tr>";
            }).join("");
          }
          if (form.querySelector(".alert")) form.querySelector(".alert").style.display = "none";
        })
        .catch(function (error) {
          if (results) results.innerHTML = "";
          alertBox(form, error.message || "Audit failed. Please try again.", true);
        })
        .finally(function () { if (submit) submit.disabled = false; });
    });
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderToolResult(data) {
    var summary = document.getElementById("toolSummary");
    var results = document.getElementById("toolResults");
    if (summary) {
      summary.textContent = data.summary || "Results ready.";
      summary.style.display = "block";
    }
    if (!results) return;
    var head = data.columns.map(function (column) {
      return "<th>" + escapeHtml(column) + "</th>";
    }).join("");
    var body = data.rows.map(function (row) {
      return "<tr>" + row.map(function (cell) {
        return "<td>" + escapeHtml(cell) + "</td>";
      }).join("") + "</tr>";
    }).join("");
    results.innerHTML = '<div style="overflow-x:auto"><table class="compare"><thead><tr>' + head + "</tr></thead><tbody>" + body + "</tbody></table></div>";
    if (data.note) {
      var note = document.createElement("p");
      note.className = "note";
      note.textContent = data.note;
      results.appendChild(note);
    }
  }

  function initToolForms() {
    document.querySelectorAll("form[data-tool-form]").forEach(function (form) {
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        var payload = { tool: form.getAttribute("data-tool") };
        new FormData(form).forEach(function (value, key) { payload[key] = value; });
        var submit = form.querySelector("button[type=submit]");
        var summary = document.getElementById("toolSummary");
        var results = document.getElementById("toolResults");
        if (submit) submit.disabled = true;
        if (summary) {
          summary.textContent = "Running preview...";
          summary.style.display = "block";
        }
        if (form.querySelector(".alert")) form.querySelector(".alert").style.display = "none";

        fetch("/api/tool", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        })
          .then(function (response) {
            return response.json().then(function (data) { return { ok: response.ok, data: data }; });
          })
          .then(function (result) {
            if (!result.ok) throw new Error(result.data.error || "Request failed");
            renderToolResult(result.data);
          })
          .catch(function (error) {
            if (results) results.innerHTML = "";
            if (summary) {
              summary.textContent = "Results will appear here";
              summary.className = "muted";
            }
            alertBox(form, error.message || "Tool run failed. Please try again.", true);
          })
          .finally(function () { if (submit) submit.disabled = false; });
      });
    });
  }

  function initNewsletter() {
    document.querySelectorAll("form[data-newsletter]").forEach(function (form) {
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        var email = form.querySelector("input[name=email]");
        var message = form.querySelector(".newsletter-msg");
        fetch("/api/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.value.trim() })
        })
          .then(function (response) { return response.json(); })
          .then(function (data) {
            if (message) message.textContent = data.message || data.error;
          })
          .catch(function () {
            if (message) message.textContent = "Network error. Please try again.";
          });
      });
    });
  }

  function initCookieBanner() {
    if (localStorage.getItem("optirank-cookie-ok")) return;
    var banner = document.createElement("div");
    banner.className = "promo";
    banner.style.position = "fixed";
    banner.style.bottom = "16px";
    banner.style.left = "16px";
    banner.style.right = "16px";
    banner.style.zIndex = "80";
    banner.style.borderRadius = "12px";
    banner.innerHTML = 'We use cookies to analyze traffic and improve your experience. Read our <a href="/cookies.html">Cookie Policy</a>. <button class="btn btn-teal" style="height:32px;margin-left:10px" id="cookieOk">Got it</button>';
    document.body.appendChild(banner);
    var ok = banner.querySelector("#cookieOk");
    ok.addEventListener("click", function () {
      localStorage.setItem("optirank-cookie-ok", "1");
      banner.remove();
    });
  }

  ready(function () {
    markActiveNav();
    initMenu();
    initTabs();
    initPricingToggle();
    initSlider();
    initForms();
    initAuditForm();
    initToolForms();
    initNewsletter();
    initCookieBanner();
    if (window.OptiRankI18n) window.OptiRankI18n.init();
  });
})();
